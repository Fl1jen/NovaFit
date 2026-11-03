// Сквозная проверка интерфейса в Chromium: node tests/e2e.js [папка-для-скриншотов]
// Структура 2.0: Сегодня · Еда · «+» · Тренировка · Прогресс, настройки — шестерёнкой,
// подробности — в нижних шторках.
const { chromium } = require('playwright');
const path = require('path');
const http = require('http');
const fs = require('fs');
const root = path.join(__dirname, '..');
const shots = process.argv[2];
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const store = () => JSON.parse(localStorage.getItem('novafit.v1'));

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
    const fail = (m) => errors.push(scheme + ': ' + m);
    const ok = (cond, m) => { if (!cond) fail(m); };
    p.on('pageerror', (e) => fail(e.message));
    p.on('console', (m) => { if (m.type() === 'error' && !/fonts\.g|favicon/.test(m.text())) fail(m.text()); });
    const snap = async (n) => { if (shots) { await p.waitForTimeout(900); await p.screenshot({ path: path.join(shots, scheme + '-' + n + '.png'), fullPage: true }); } };
    const sheetShot = async (n) => { if (shots) { await p.waitForTimeout(700); await p.screenshot({ path: path.join(shots, scheme + '-' + n + '.png') }); } };
    // шторка открыта / закрыта
    const sheetOpen = async () => { await p.waitForSelector('#sheet.show .sheet-panel'); await p.waitForTimeout(450); };
    const closeSheet = async () => { await p.keyboard.press('Escape'); await p.waitForSelector('#sheet', { state: 'hidden' }); };
    const tab = async (t) => { await p.click('.nav-btn[data-tab=' + t + ']'); await p.waitForTimeout(120); };
    const noOverflow = async (where) => ok(!(await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)), 'горизонтальная прокрутка: ' + where);
    const planKcal = () => p.$$eval('.tl-item.k-meal:not(.done) .tl-sub .kcal', (bs) => bs.reduce((s, x) => s + +x.textContent, 0));

    // ── знакомство ──
    await p.goto(url);
    ok(await p.isHidden('.nav'), 'нижняя панель видна до заполнения профиля');
    await snap('0-onboarding');
    await p.fill('#pf-target', '50');
    await p.click('#profile-form button[type=submit]');
    ok(await p.isVisible('.note.n-danger'), 'нет ошибки валидации');
    ok((await p.inputValue('#pf-target')) === '50', 'введённое значение пропало после ошибки');
    await p.fill('#pf-target', '68');
    await p.click('#profile-form button[type=submit]');
    await p.waitForSelector('.tl');
    ok(await p.isVisible('.nav'), 'нет нижней панели');

    // ── «Сегодня»: одна заметка, лента дня ──
    ok((await p.$$('.view > .notice')).length <= 1, 'на главном больше одной заметки');
    ok(/Доешь/.test(await p.textContent('.view > .notice')), 'нет заметки «доешь в ближайшие сутки»');
    ok(await p.evaluate(() => { const s = JSON.parse(localStorage.getItem('novafit.v1')); return Object.values(s.plans)[0].meals.some((m) => m.items.some((it) => it.id === 'chicken_breast')); }), 'курица со сроком «завтра» не попала в план');
    const kinds = await p.$$eval('.tl > li', (ls) => ls.map((l) => (l.className.match(/k-(\w+)/) || [, 'now'])[1]));
    ok(kinds[0] === 'wake' && kinds.includes('bed') && kinds.filter((k) => k === 'meal').length === 4, 'в ленте дня не те пункты: ' + kinds.join(','));
    ok(await p.isVisible('.tl-now'), 'нет отметки «сейчас»');
    await noOverflow('сегодня');
    await snap('1-today');
    // «Съел» галочкой прямо в ленте
    await p.click('.tl-item.k-meal [data-act=eat][data-i="0"]');
    ok(await p.isVisible('.tl-item.k-meal.done'), '«Съел» не сработал');
    ok(await p.evaluate(() => +document.querySelector('.ring-num').dataset.n > 0), 'кольцо калорий не изменилось');
    // приём пищи в шторке: состав, шаги, «другое блюдо»
    await p.click('.tl-item.k-meal[data-meal="1"] .tl-main');
    await sheetOpen();
    ok((await p.$$('.sheet-body .list .row')).length >= 2, 'в шторке приёма нет продуктов');
    const dish1 = await p.textContent('.sheet-body .dish');
    await sheetShot('2-meal');
    await p.click('.sheet-body [data-act=swap]');
    await p.waitForTimeout(200);
    ok((await p.textContent('.sheet-body .dish')) !== dish1 || /Другое блюдо/.test(await p.textContent('#toast')), '«Другое блюдо» не поменяло блюдо');
    await closeSheet();

    // ── «+»: еда вне плана ──
    const kcalBefore = await planKcal();
    await p.click('.nav-fab');
    await sheetOpen();
    ok((await p.$$('.sheet-body .tile')).length === 6, 'в «+» не 6 действий');
    await sheetShot('3-add');
    await p.click('.tile[data-sheet=eat]');
    await p.waitForSelector('#extra-search');
    ok(await p.isVisible('#extra-results .pill'), 'нет быстрых вариантов');
    await p.fill('#extra-search', 'арахис');
    ok(!(await p.isVisible('#extra-results .label')), 'быстрые варианты не спрятались при поиске');
    await p.click('[data-act=extra-pick][data-id=peanuts]');
    await p.fill('#extra-qty', '80');
    await p.click('[data-act=extra-add]');
    await p.waitForSelector('#sheet', { state: 'hidden' });
    ok(await p.isVisible('.tl-item.k-extra'), 'еда вне плана не появилась в ленте');
    const kcalAfter = await planKcal();
    ok(kcalBefore - kcalAfter > 250, 'план не уменьшился после еды вне плана: ' + kcalBefore + ' → ' + kcalAfter);

    // ── «Еда → Холодильник»: сроки, добавление, просрочка ──
    await tab('food');
    ok(await p.isVisible('.seg[data-k=seg-food]'), 'нет переключателя Холодильник/Рецепты/Покупки');
    ok(await p.isVisible('.exp.soon'), 'нет метки срока');
    await p.click('.tile[data-sheet=stock-add]');
    await sheetOpen();
    await p.fill('#food-search', 'фарш');
    await p.click('[data-act=pick-food][data-id=minced_beef]');
    ok((await p.inputValue('#add-exp')).length === 10, 'срок не подставился');
    await p.fill('#add-qty', '500');
    await p.click('[data-act=add-food]');
    await closeSheet();
    ok(await p.isVisible('.row[data-sheet=stock-item][data-id=minced_beef]'), 'продукт не добавился');
    await p.click('.row[data-sheet=stock-item][data-id=cheese]');
    await sheetOpen();
    await p.fill('#stock-exp', '2020-01-01');
    await p.click('[data-act=stock-save]');
    await p.waitForSelector('#sheet', { state: 'hidden' });
    ok(await p.isVisible('.exp.bad'), 'просрочка не отмечена');
    await noOverflow('холодильник');
    await snap('4-fridge');
    await tab('today');
    ok(await p.isVisible('.notice [data-act=drop-expired]'), 'нет предупреждения о просрочке');
    ok(await p.evaluate(() => { const s = JSON.parse(localStorage.getItem('novafit.v1')); return !Object.values(s.plans)[0].meals.some((m) => !m.eaten && m.items.some((it) => it.id === 'cheese')); }), 'просроченный сыр в плане');
    await p.click('[data-act=drop-expired]');
    ok(!(await p.isVisible('[data-act=drop-expired]')), 'просрочка не убралась');
    // тарелка
    await tab('food');
    await p.click('.tile[data-sheet=plate]');
    await sheetOpen();
    await p.click('[data-act=calc-toggle][data-id=buckwheat]');
    await p.click('[data-act=calc-toggle][data-id=chicken_breast]');
    ok((await p.$$('.sheet-body .list .row')).length === 2, 'тарелка не посчитала граммы');
    await sheetShot('5-plate');
    await closeSheet();

    // ── «Еда → Рецепты» ──
    await p.click('.seg-btn[data-v=recipes]');
    ok(/можно приготовить/.test(await p.textContent('.rec-summary')), 'нет сводки «что приготовить»');
    ok((await p.$$('#rec-results .sec .row')).length > 0, 'нет блюд «можно сейчас»');
    await p.click('[data-act=rec-nocook]');
    ok(await p.$$eval('#rec-results .row', (rs) => rs.length > 0 && rs.every((r) => /без готовки/.test(r.textContent))), 'фильтр «без готовки» пропустил блюдо с готовкой');
    await p.click('[data-act=rec-nocook]');
    await p.fill('#rec-search', 'борщ');
    await p.waitForTimeout(150);
    ok((await p.$$('#rec-results .row')).length === 1, 'поиск «борщ»');
    await p.$eval('#rec-borscht', (r) => { const g = r.closest('details'); if (g) g.open = true; });
    await p.click('#rec-borscht');
    await sheetOpen();
    ok(await p.isVisible('.sheet-body [data-act=rec-shop]'), 'нет кнопки «Недостающее — в покупки»');
    await p.click('.sheet-body [data-act=rec-shop]');
    ok(await p.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('novafit.v1')).shopExtra).length > 0), 'недостающее не попало в покупки');
    await closeSheet();
    await p.fill('#rec-search', '');
    await p.waitForTimeout(150);
    await p.click('#rec-results .sec .row >> nth=0');
    await sheetOpen();
    const pinBtn = await p.$('.sheet-body [data-act=rec-pin]');
    const pinId = await pinBtn.getAttribute('data-id');
    await pinBtn.click();
    await p.waitForSelector('#sheet', { state: 'hidden' });
    ok(await p.evaluate((id) => Object.values(JSON.parse(localStorage.getItem('novafit.v1')).plans)[0].meals.some((m) => m.recipeId === id && m.pinned), pinId), 'рецепт не поставился в план');
    await noOverflow('рецепты');
    await snap('6-recipes');

    // ── «Еда → Покупки» ──
    await p.click('.seg-btn[data-v=shop]');
    ok(await p.isVisible('.check-row .row-sub'), 'нет английских названий в покупках');
    ok(/из рецепта/.test(await p.textContent('#view')), 'добавленное из рецепта не видно в покупках');
    await p.click('.seg[data-k=seg-shop] .seg-btn[data-v="7"]');
    const rows7 = (await p.$$('.check-row')).length;
    ok(rows7 > 0, 'нет покупок на неделю');
    await p.click('.check-row >> nth=0');
    await p.click('[data-act=shop-apply]');
    ok(/В холодильник: 1/.test(await p.textContent('#toast')), 'купленное не ушло в холодильник');
    await snap('7-shop');

    // ── «Тренировка»: подходы, таймер отдыха и подход на время ──
    await tab('train');
    ok((await p.$$('.list .row[data-sheet=exercise]')).length >= 4, 'нет списка упражнений');
    await p.click('.list .row[data-sheet=exercise] >> nth=0');
    await sheetOpen();
    ok(/Как делать/i.test(await p.textContent('.sheet-body')), 'нет техники упражнения');
    await closeSheet();
    await p.click('[data-act=w-start]');
    const inputs = await p.$$('[data-bind=set]');
    await inputs[0].fill('12'); await inputs[0].press('Tab');
    await p.waitForSelector('#timer.show');
    ok(/Отдых/.test(await p.textContent('#timer-label')), 'таймер отдыха не запустился');
    ok(/1 из 3/.test(await p.textContent('.ex >> nth=0')), 'счётчик подходов не обновился');
    await snap('8-train');
    await p.click('[data-act=timer-add][data-d="15"]');
    await p.click('[data-act=timer-stop]');
    await p.waitForTimeout(400);
    ok(await p.isHidden('#timer'), 'таймер не закрылся');
    const play = await p.$('[data-act=work-start]');
    ok(!!play, 'нет кнопки подхода на время');
    if (play) {
      await p.evaluate(() => { document.querySelector('[data-act=work-start]').dataset.s = '1'; });
      await play.click();
      await p.waitForTimeout(1700);
      ok(/Отдых/.test(await p.textContent('#timer-label')), 'после подхода на время не начался отдых');
      await p.click('[data-act=timer-stop]');
    }
    for (const i of (await p.$$('[data-bind=set]')).slice(1, 3)) await i.fill('12');
    await p.click('[data-act=w-finish]');
    ok(await p.isVisible('.list .row:has-text("повт.")'), 'тренировка не попала в историю');

    // ── сон через «+» ──
    await p.click('.nav-fab');
    await sheetOpen();
    await p.click('.tile[data-sheet=sleep]');
    await p.waitForSelector('#sl-bed');
    await p.fill('#sl-bed', '00:30'); await p.fill('#sl-wake', '07:00');
    await p.click('[data-act=sleep-q][data-q="4"]');
    await p.click('[data-act=sleep-save]');
    await p.waitForSelector('#sheet', { state: 'hidden' });
    await tab('today');
    ok(/Сон 6 ч 30 мин/.test(await p.textContent('.tl-item.k-wake')), 'сон не отметился в ленте');

    // ── настройки: «нет аппетита», вода ──
    await p.click('[data-act=open-settings]');
    ok(await p.isVisible('.nav-btn.on[data-tab=today]'), 'в настройках не подсвечен раздел, откуда пришли');
    await p.check('#low-appetite', { force: true });
    await p.waitForTimeout(300);
    await p.click('[data-act=back]');
    ok((await p.$$('.tl-item.k-meal')).length >= 5, 'в режиме «нет аппетита» меньше 5 приёмов');
    ok(/Перед сном/i.test(await p.textContent('.tl')), 'нет перекуса перед сном');
    ok((await p.$$('.tl-item.k-meal.done')).length >= 1, 'съеденный завтрак потерялся при смене режима');
    await p.click('.pill-mini[data-sheet=water]');
    await sheetOpen();
    ok(/Перелёт/.test(await p.textContent('.sheet-body')), 'нет рекомендации по воде');
    await closeSheet();
    await snap('1c-appetite');

    // ── «Прогресс»: отчёт, вес, замеры ──
    await tab('progress');
    ok(await p.isVisible('#report .kchart'), 'нет недельного отчёта');
    await p.click('[data-act=report-week][data-d="-1"]');
    ok(/Прошлая неделя/.test(await p.textContent('#report h2')), 'листание отчёта');
    await p.click('[data-act=report-week][data-d="1"]');
    await p.click('.goal-card [data-sheet=weight]');
    await sheetOpen();
    await p.fill('#w-kg', '60.6'); await p.click('[data-act=w-add]');
    await p.waitForSelector('#sheet', { state: 'hidden' });
    ok(/60,6/.test(await p.textContent('.goal-big')), 'вес не записался');
    await p.click('#measures .sec-head [data-sheet=measure]');
    await sheetOpen();
    await p.fill('#ms-waist', '74'); await p.fill('#ms-arm', '29.5');
    await p.click('[data-act=measure-save]');
    await p.waitForSelector('#sheet', { state: 'hidden' });
    ok(/74 см/.test(await p.textContent('#measures .mtable')), 'замеры не сохранились');
    await noOverflow('прогресс');
    await snap('9-progress');

    // ── настройки: напоминания и календарь ──
    await p.click('[data-act=open-settings]');
    await snap('10-settings');
    await p.click('#reminders');
    await sheetOpen();
    await p.check('#rem-enabled', { force: true });
    await p.waitForSelector('[data-act=rem-test]');
    ok(await p.$eval('#rem-enabled', (e) => e.checked), 'напоминания не включились');
    const [dl] = await Promise.all([p.waitForEvent('download'), p.click('[data-act=ics]')]);
    const ics = fs.readFileSync(await dl.path(), 'utf8');
    ok(/BEGIN:VCALENDAR/.test(ics) && /Завтрак · NovaFit/.test(ics), 'ics некорректен');
    await sheetShot('11-reminders');
    await closeSheet();
    ok(/включены/.test(await p.textContent('#reminders')), 'строка напоминаний не обновилась');
    await noOverflow('настройки');

    // ── «Назад» на Android: шторка → настройки → откуда пришли → главный ──
    await p.click('.row[data-sheet=data]');
    await sheetOpen();
    ok((await p.evaluate(() => window.__nfBack())) === true && (await p.isHidden('#sheet.show')), '«Назад» не закрыл шторку');
    await p.waitForTimeout(350);
    ok((await p.evaluate(() => window.__nfBack())) === true && (await p.isVisible('.goal-card')), '«Назад» из настроек не вернул в «Прогресс»');
    ok((await p.evaluate(() => window.__nfBack())) === true && (await p.isVisible('.tl')), '«Назад» не вернул на главный');
    ok((await p.evaluate(() => window.__nfBack())) === false, '«Назад» на главном должен выходить');

    // ── смена часового пояса: заметка и советы ──
    await p.evaluate(() => { const s = JSON.parse(localStorage.getItem('novafit.v1')); s.lastOffset = new Date().getTimezoneOffset() + 240; localStorage.setItem('novafit.v1', JSON.stringify(s)); });
    await p.reload();
    await p.waitForSelector('.tl');
    ok(await p.isVisible('.notice.tz'), 'нет подсказки о смене часового пояса');
    ok(/\+4 ч, на восток/.test(await p.textContent('.notice.tz')), 'неверная разница часовых поясов');
    await p.click('.notice.tz .btn');
    await sheetOpen();
    await p.click('[data-act=tz-ok]');
    await p.waitForSelector('#sheet', { state: 'hidden' });
    ok(!(await p.isVisible('.notice.tz')), 'подсказка не скрылась');

    // ── данные переживают перезагрузку ──
    await p.reload();
    await p.waitForSelector('.tl');
    ok(await p.evaluate(() => { const s = JSON.parse(localStorage.getItem('novafit.v1')); return s.measures.length === 1 && s.reminders.enabled && Object.keys(s.extras).length === 1 && s.workouts.length === 1; }), 'данные не сохранились');
    await ctx.close();
  }
  await b.close();
  server.close();
  if (errors.length) { console.log('ОШИБКИ:\n' + errors.join('\n')); process.exit(1); }
  console.log('e2e: всё ок');
})();
