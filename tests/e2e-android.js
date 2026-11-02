// Проверка веб-части APK с имитацией Android-моста: node tests/e2e-android.js
// (сначала: node tools/build-android.js)
const { chromium } = require('playwright');
const path = require('path');
const http = require('http');
const fs = require('fs');
const root = path.join(__dirname, '..', 'android', 'app', 'src', 'main', 'assets', 'www');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.png': 'image/png', '.svg': 'image/svg+xml' };
(async () => {
  const server = http.createServer((req, res) => {
    const f = path.join(root, decodeURIComponent(req.url.split('?')[0]).replace(/^\/$/, '/index.html'));
    if (!fs.existsSync(f)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(res);
  }).listen(0);
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [], external = [];
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('request', (r) => { if (!r.url().startsWith('http://localhost')) external.push(r.url()); });
  await p.addInitScript(() => {
    const calls = (window.__calls = []);
    const rec = (name, ret) => (...a) => { calls.push([name, ...a]); return typeof ret === 'function' ? ret(...a) : ret; };
    let perm = 'default';
    window.NovaAndroid = {
      version: rec('version', '1'), notifState: () => perm,
      requestNotifications: rec('requestNotifications', () => { perm = 'granted'; setTimeout(() => window.__nfPerm && window.__nfPerm('granted'), 50); }),
      exactAlarms: () => false, openAlarmSettings: rec('openAlarmSettings'),
      schedule: rec('schedule'), timer: rec('timer'), cancelTimer: rec('cancelTimer'), notifyNow: rec('notifyNow'),
      keepAwake: rec('keepAwake'), vibrate: rec('vibrate'), copy: rec('copy', true), openCalendar: rec('openCalendar', true),
    };
  });
  await p.goto('http://localhost:' + server.address().port + '/');
  const check = (c, m) => { if (!c) errors.push(m); };
  const calls = () => p.evaluate(() => window.__calls);
  const fontOk = await p.evaluate(async () => { await document.fonts.ready; return document.fonts.check('16px "Golos Text"') && [...document.fonts].some((f) => f.family.includes('Golos') && f.status === 'loaded'); });
  check(fontOk, 'шрифт не загрузился локально');
  await p.click('#profile-form button[type=submit]');
  await p.waitForSelector('.timeline');
  // напоминания → разрешение → расписание на 7 дней
  await p.click('.nav-btn[data-tab=profile]');
  await p.click('#reminders > summary');
  await p.check('#rem-enabled', { force: true });
  await p.waitForTimeout(300);
  let c = await calls();
  check(c.some((x) => x[0] === 'requestNotifications'), 'не запросил разрешение');
  const sched = c.filter((x) => x[0] === 'schedule').pop();
  const list = sched ? JSON.parse(sched[1]) : [];
  check(list.length >= 20, 'мало напоминаний на неделю: ' + list.length);
  check(new Set(list.map((x) => x.id)).size === list.length, 'id напоминаний повторяются');
  check(list.every((x) => x.at > Date.now()), 'напоминания в прошлом');
  check(await p.isVisible('[data-act=alarm-settings]'), 'нет кнопки точных будильников');
  await p.click('[data-act=alarm-settings]');
  await p.click('[data-act=ics]');
  await p.click('[data-act=rem-test]');
  await p.click('#profile-form ~ * , details:has(#import-text), [data-act=export]').catch(() => {});
  // тренировка: экран, таймер с системным будильником
  await p.click('.nav-btn[data-tab=train]');
  await p.click('[data-act=w-start]');
  const inp = await p.$('[data-bind=set]');
  await inp.fill('10'); await inp.press('Tab');
  await p.waitForSelector('#timer.show');
  await p.click('[data-act=timer-add][data-d="15"]');
  await p.click('[data-act=timer-stop]');
  // «Назад» уводит на главный экран
  const back = await p.evaluate(() => window.__nfBack());
  check(back === true && (await p.isVisible('.timeline')), '«Назад» не вернул на главный');
  check((await p.evaluate(() => window.__nfBack())) === false, '«Назад» на главном должен выходить');
  c = await calls();
  const names = new Set(c.map((x) => x[0]));
  ['openAlarmSettings', 'openCalendar', 'notifyNow', 'keepAwake', 'timer', 'cancelTimer'].forEach((n) => check(names.has(n), 'не вызван ' + n));
  const t = c.filter((x) => x[0] === 'timer');
  check(t.length >= 2 && t[1][1] > t[0][1] + 14000, '+15 с не передвинул системный будильник');
  check(c.some((x) => x[0] === 'keepAwake' && x[1] === true), 'экран не удерживается');
  check(!external.length, 'внешние запросы: ' + external.join(', '));
  await b.close(); server.close();
  if (errors.length) { console.log('ОШИБКИ:\n' + errors.join('\n')); process.exit(1); }
  console.log('android e2e: всё ок · напоминаний на неделю: ' + list.length);
})();
