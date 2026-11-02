// Сквозная проверка интерфейса в Chromium: node tests/e2e.js [папка-для-скриншотов]
const { chromium } = require('playwright');
const path = require('path');
const shots = process.argv[2];
(async () => {
  const b = await chromium.launch();
  const errors = [];
  for (const scheme of ['light', 'dark']) {
    const p = await b.newPage({ viewport: { width: 390, height: 844 }, colorScheme: scheme, deviceScaleFactor: 2 });
    p.on('pageerror', (e) => errors.push(e.message));
    p.on('console', (m) => { if (m.type() === 'error' && !/fonts\.g/.test(m.text())) errors.push(m.text()); });
    await p.goto('file://' + path.join(__dirname, '..', 'index.html'));
    const snap = async (n) => { if (shots) await p.screenshot({ path: path.join(shots, scheme + '-' + n + '.png'), fullPage: true }); };
    await snap('0-onboarding');
    // ошибка валидации
    await p.fill('#pf-target', '50');
    await p.click('#profile-form button[type=submit]');
    if (!(await p.isVisible('.note-danger'))) errors.push('нет ошибки валидации');
    await p.fill('#pf-target', '68');
    await p.click('#profile-form button[type=submit]');
    await p.waitForSelector('.timeline');
    await snap('1-today');
    await p.click('[data-act=eat][data-i="0"]');
    if (!(await p.isVisible('.meal.eaten'))) errors.push('Съел не сработал');
    await p.click('[data-act=swap][data-i="1"]');
    await p.click('.nav-btn[data-tab=food]');
    await p.fill('#food-search', 'твор');
    await p.click('[data-act=pick-food][data-id=cottage9]');
    await p.fill('#add-qty', '400');
    await p.click('[data-act=add-food]');
    if (!(await p.isVisible('#inv-cottage9'))) errors.push('продукт не добавился');
    await snap('2-stock');
    await p.click('[data-act=seg][data-seg=calc]');
    await p.click('[data-act=calc-toggle][data-id=buckwheat]');
    await p.click('[data-act=calc-toggle][data-id=chicken_breast]');
    await p.click('[data-act=calc-toggle][data-id=sunflower_oil]');
    await snap('3-calc');
    await p.click('[data-act=seg][data-seg=recipes]');
    await snap('4-recipes');
    await p.click('[data-act=seg][data-seg=shop]');
    await snap('5-shop');
    await p.click('.nav-btn[data-tab=train]');
    await p.click('[data-act=w-start]');
    const inputs = await p.$$('[data-bind=set]');
    for (const i of inputs.slice(0, 3)) await i.fill('12');
    await snap('6-train');
    await p.click('[data-act=w-finish]');
    await p.click('.nav-btn[data-tab=sleep]');
    await p.fill('#sl-bed', '00:30'); await p.fill('#sl-wake', '07:00');
    await p.click('[data-act=sleep-save]');
    await snap('7-sleep');
    await p.click('.nav-btn[data-tab=profile]');
    await p.fill('#w-kg', '60.6'); await p.click('[data-act=w-add]');
    await snap('8-profile');
    const over = await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    if (over) errors.push(scheme + ': горизонтальная прокрутка');
    await p.close();
  }
  await b.close();
  if (errors.length) { console.log('ОШИБКИ:\n' + errors.join('\n')); process.exit(1); }
  console.log('e2e: всё ок');
})();
