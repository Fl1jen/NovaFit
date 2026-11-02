// Сквозная проверка интерфейса в Chromium: node tests/e2e.js [папка-для-скриншотов]
const { chromium } = require('playwright');
const path = require('path');
const http = require('http');
const fs = require('fs');
const root = path.join(__dirname, '..');
const shots = process.argv[2];
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };

(async () => {
  const server = http.createServer((req, res) => {
    const f = path.join(root, decodeURIComponent(req.url.split('?')[0]).replace(/^\/$/, '/index.html'));
    if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(res);
  }).listen(0);
  const url = 'http://localhost:' + server.address().port + '/';
  const b = await chromium.launch();
  const errors = [];
  const check = (cond, msg) => { if (!cond) errors.push(msg); };
  for (const scheme of ['light', 'dark']) {
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, colorScheme: scheme, deviceScaleFactor: 2, acceptDownloads: true });
    await ctx.grantPermissions(['notifications'], { origin: url.slice(0, -1) });
    const p = await ctx.newPage();
    p.on('pageerror', (e) => errors.push(scheme + ': ' + e.message));
    p.on('console', (m) => { if (m.type() === 'error' && !/fonts\.g|favicon/.test(m.text())) errors.push(scheme + ': ' + m.text()); });
    await p.goto(url);
    const snap = async (n) => { if (shots) { await p.waitForTimeout(900); await p.screenshot({ path: path.join(shots, scheme + '-' + n + '.png'), fullPage: true }); } };
    await snap('0-onboarding');
    await p.fill('#pf-target', '50');
    await p.click('#profile-form button[type=submit]');
    check(await p.isVisible('.note-danger'), 'нет ошибки валидации');
    await p.fill('#pf-target', '68');
    await p.click('#profile-form button[type=submit]');
    await p.waitForSelector('.timeline');
    check(await p.isVisible('.expiring'), 'нет блока «скоро испортится»');
    check(await p.$$eval('.timeline .items li', (ls) => ls.some((l) => /Куриная грудка/.test(l.textContent))), 'курица со сроком «завтра» не попала в план');
    await snap('1-today');
    await p.click('[data-act=eat][data-i="0"]');
    check(await p.isVisible('.meal.eaten'), 'Съел не сработал');
    await p.click('[data-act=swap][data-i="1"]');

    // еда вне плана
    const kcalBefore = await p.$eval('.timeline', (t) => Array.from(t.querySelectorAll('.meal:not(.eaten) .macros b')).reduce((s, b) => s + +b.textContent, 0));
    await p.click('[data-act=extra-toggle]');
    await p.fill('#extra-search', 'арахис');
    await p.click('[data-act=extra-pick][data-id=peanuts]');
    await p.fill('#extra-qty', '80');
    await p.click('[data-act=extra-add]');
    check(await p.isVisible('.extras'), 'еда вне плана не появилась');
    const kcalAfter = await p.$eval('.timeline', (t) => Array.from(t.querySelectorAll('.meal:not(.eaten) .macros b')).reduce((s, b) => s + +b.textContent, 0));
    check(kcalBefore - kcalAfter > 250, 'план не уменьшился после еды вне плана: ' + kcalBefore + ' → ' + kcalAfter);
    await snap('1b-extra');

    // запасы и сроки
    await p.click('.nav-btn[data-tab=food]');
    check(await p.isVisible('.exp-badge.soon'), 'нет метки срока');
    await p.fill('#food-search', 'фарш');
    await p.click('[data-act=pick-food][data-id=minced_beef]');
    check((await p.inputValue('#add-exp')).length === 10, 'срок не подставился');
    await p.fill('#add-qty', '500');
    await p.click('[data-act=add-food]');
    check(await p.isVisible('#inv-minced_beef'), 'продукт не добавился');
    await p.click('[data-act=exp-edit][data-id=cheese]');
    await p.fill('#exp-cheese', '2020-01-01');
    await p.click('[data-act=exp-save]');
    check(await p.isVisible('.exp-badge.bad'), 'просрочка не отмечена');
    await snap('2-stock');
    await p.click('.nav-btn[data-tab=today]');
    check(await p.isVisible('[data-act=drop-expired]'), 'нет предупреждения о просрочке');
    check(!(await p.$$eval('.timeline .meal:not(.eaten) .items li', (ls) => ls.some((l) => /Сыр твёрдый/.test(l.textContent)))), 'просроченный сыр в плане');
    await p.click('[data-act=drop-expired]');
    await p.click('.nav-btn[data-tab=food]');
    await p.click('[data-act=seg][data-seg=calc]');
    await p.click('[data-act=calc-toggle][data-id=buckwheat]');
    await p.click('[data-act=calc-toggle][data-id=chicken_breast]');
    await snap('3-calc');
    await p.click('[data-act=seg][data-seg=recipes]');
    // «Что приготовить»: группы, фильтры, поиск, в план, в покупки
    check(/можно приготовить/.test(await p.textContent('.rec-summary')), 'нет сводки «что приготовить»');
    const nowCount = await p.$$eval('#recg-now ~ .recipes details.recipe, h2.rec-h + .recipes details.recipe', (x) => x.length);
    check(nowCount > 0, 'нет блюд «можно приготовить сейчас»');
    await p.click('[data-act=rec-nocook]');
    const nocook = await p.$$eval('details.recipe', (ds) => ds.every((d) => /без готовки/.test(d.textContent)));
    check(nocook, 'фильтр «без готовки» пропустил блюдо с готовкой');
    await p.click('[data-act=rec-nocook]');
    await p.fill('#rec-search', 'борщ');
    await p.waitForTimeout(150);
    check((await p.$$eval('#rec-results details.recipe', (x) => x.length)) === 1, 'поиск «борщ»');
    const borscht = await p.$('#rec-borscht');
    await borscht.evaluate((d) => { d.open = true; const grp = d.closest('details.rec-group'); if (grp) grp.open = true; });
    check(await p.isVisible('#rec-borscht [data-act=rec-shop]'), 'нет кнопки «Недостающее — в покупки»');
    await p.click('#rec-borscht [data-act=rec-shop]');
    check(await p.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('novafit.v1')).shopExtra).length > 0), 'недостающее не попало в покупки');
    await p.fill('#rec-search', '');
    await p.waitForTimeout(150);
    const firstNow = await p.$('h2.rec-h + .recipes details.recipe');
    await firstNow.evaluate((d) => (d.open = true));
    const pinBtn = await firstNow.$('[data-act=rec-pin]');
    const pinId = await pinBtn.getAttribute('data-id');
    await pinBtn.click();
    check(await p.evaluate((id) => Object.values(JSON.parse(localStorage.getItem('novafit.v1')).plans)[0].meals.some((m) => m.recipeId === id && m.pinned), pinId), 'рецепт не поставился в план');
    await snap('4-recipes');
    await p.click('[data-act=seg][data-seg=shop]');
    check(await p.isVisible('.shop .en'), 'нет английских названий в покупках');
    check(/из рецепта/.test(await p.textContent('.shop')), 'добавленное из рецепта не видно в покупках');
    await snap('5-shop');

    // тренировка и таймер
    await p.click('.nav-btn[data-tab=train]');
    await p.click('[data-act=w-start]');
    const inputs = await p.$$('[data-bind=set]');
    await inputs[0].fill('12'); await inputs[0].press('Tab');
    await p.waitForSelector('#timer.show');
    check(/Отдых/.test(await p.textContent('#timer-label')), 'таймер отдыха не запустился');
    await snap('6-train-timer');
    await p.click('[data-act=timer-add][data-d="15"]');
    await p.click('[data-act=timer-stop]');
    await p.waitForTimeout(400);
    check(await p.isHidden('#timer'), 'таймер не закрылся');
    // подход на время (последнее упражнение — кор)
    const play = await p.$('[data-act=work-start]');
    check(!!play, 'нет кнопки подхода на время');
    if (play) {
      await p.evaluate(() => { document.querySelector('[data-act=work-start]').dataset.s = '1'; });
      await play.click();
      await p.waitForTimeout(1700);
      check(/Отдых/.test(await p.textContent('#timer-label')), 'после подхода на время не начался отдых');
      await p.click('[data-act=timer-stop]');
    }
    for (const i of (await p.$$('[data-bind=set]')).slice(1, 3)) await i.fill('12');
    await p.click('[data-act=w-finish]');

    await p.click('.nav-btn[data-tab=sleep]');
    await p.fill('#sl-bed', '00:30'); await p.fill('#sl-wake', '07:00');
    await p.click('[data-act=sleep-save]');
    await snap('7-sleep');

    // профиль: «нет аппетита», отчёт, замеры, напоминания
    await p.click('.nav-btn[data-tab=profile]');
    await p.check('#low-appetite', { force: true });
    await p.waitForTimeout(300);
    await p.click('.nav-btn[data-tab=today]');
    check((await p.$$eval('.timeline .meal', (x) => x.length)) >= 5, 'в режиме «нет аппетита» меньше 5 приёмов');
    check(/Перед сном/.test(await p.textContent('.timeline')), 'нет перекуса перед сном');
    check((await p.$$eval('.timeline .meal.eaten', (x) => x.length)) >= 1, 'съеденный завтрак потерялся при смене режима');
    await p.click('[data-act=water-toggle]');
    check(/Перелёт/.test(await p.textContent('.water')), 'нет рекомендации по воде');
    await snap('1c-appetite');
    await p.click('.nav-btn[data-tab=profile]');
    check(await p.isVisible('#report .kchart'), 'нет недельного отчёта');
    await p.click('[data-act=report-week][data-d="-1"]');
    check(/Прошлая неделя/.test(await p.textContent('#report h2')), 'листание отчёта');
    await p.click('[data-act=report-week][data-d="1"]');
    await p.fill('#w-kg', '60.6'); await p.click('[data-act=w-add]');
    await p.click('#measures > summary');
    await p.fill('#ms-waist', '74'); await p.fill('#ms-arm', '29.5');
    await p.click('[data-act=measure-save]');
    check(/74 см/.test(await p.textContent('#measures .mtable')), 'замеры не сохранились');
    await p.click('#reminders > summary');
    await p.check('#rem-enabled', { force: true });
    await p.waitForSelector('[data-act=rem-test]');
    check(await p.$eval('#rem-enabled', (e) => e.checked), 'напоминания не включились');
    const [dl] = await Promise.all([p.waitForEvent('download'), p.click('[data-act=ics]')]);
    const ics = fs.readFileSync(await dl.path(), 'utf8');
    check(/BEGIN:VCALENDAR/.test(ics) && /Завтрак · NovaFit/.test(ics), 'ics некорректен');
    await snap('8-profile');
    const over = await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    check(!over, scheme + ': горизонтальная прокрутка');
    // смена часового пояса: подсказка и советы при джетлаге
    await p.evaluate(() => { const s = JSON.parse(localStorage.getItem('novafit.v1')); s.lastOffset = new Date().getTimezoneOffset() + 240; localStorage.setItem('novafit.v1', JSON.stringify(s)); });
    await p.reload();
    await p.click('.nav-btn[data-tab=today]');
    check(await p.isVisible('.note.tz'), 'нет подсказки о смене часового пояса');
    check(/\+4 ч, на восток/.test(await p.textContent('.note.tz')), 'неверная разница часовых поясов');
    await p.click('[data-act=tz-ok]');
    check(!(await p.isVisible('.note.tz')), 'подсказка не скрылась');
    // данные переживают перезагрузку
    await p.reload();
    await p.waitForSelector('.view');
    check(await p.evaluate(() => { const s = JSON.parse(localStorage.getItem('novafit.v1')); return s.measures.length === 1 && s.reminders.enabled && Object.keys(s.extras).length === 1; }), 'данные не сохранились');
    await ctx.close();
  }
  await b.close();
  server.close();
  if (errors.length) { console.log('ОШИБКИ:\n' + errors.join('\n')); process.exit(1); }
  console.log('e2e: всё ок');
})();
