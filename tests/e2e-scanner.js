// Сквозной тест сканера: фейковая камера Chromium показывает штрихкод EAN-13,
// приложение распознаёт его (ZXing), «находит» товар (ответ Open Food Facts
// подменён) и добавляет в запасы. Запуск: node tests/e2e-scanner.js
const { chromium } = require('playwright');
const path = require('path');
const http = require('http');
const fs = require('fs');
const os = require('os');

const root = path.join(__dirname, '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };

// ── EAN-13 → кадр Y4M (чёрно-белые полосы на белом фоне) ──
const L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
const G = ['0100111', '0110011', '0011011', '0100001', '0011101', '0111001', '0000101', '0010001', '0001001', '0010111'];
const R = ['1110010', '1100110', '1101100', '1000010', '1011100', '1001110', '1010000', '1000100', '1001000', '1110100'];
const PAR = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];
function eanBits(code) {
  const d = code.split('').map(Number);
  let bits = '101';
  d.slice(1, 7).forEach((ch, i) => { bits += (PAR[d[0]][i] === 'L' ? L : G)[ch]; });
  bits += '01010';
  d.slice(7).forEach((ch) => { bits += R[ch]; });
  return bits + '101';
}
function y4m(code, file) {
  const W = 1280, H = 720, mod = 6, bits = eanBits(code);
  const x0 = Math.floor((W - bits.length * mod) / 2), y0 = H / 2 - 120, y1 = H / 2 + 120;
  const Y = Buffer.alloc(W * H, 235);
  for (let y = y0; y < y1; y++) for (let i = 0; i < bits.length; i++) if (bits[i] === '1') Y.fill(16, y * W + x0 + i * mod, y * W + x0 + (i + 1) * mod);
  const UV = Buffer.alloc((W / 2) * (H / 2) * 2, 128);
  const parts = [Buffer.from('YUV4MPEG2 W' + W + ' H' + H + ' F10:1 Ip A1:1 C420jpeg\n')];
  for (let f = 0; f < 10; f++) parts.push(Buffer.from('FRAME\n'), Y, UV);
  fs.writeFileSync(file, Buffer.concat(parts));
}

const OFF_PASTA = {
  status: 1, code: '8076800195057',
  product: {
    product_name: 'Spaghetti n°5', brands: 'Barilla', quantity: '500 g', product_quantity: '500', product_quantity_unit: 'g',
    nutriments: { 'energy-kcal_100g': 359, proteins_100g: 13, fat_100g: 2, carbohydrates_100g: 71 },
    categories_tags: ['en:cereals-and-potatoes', 'en:pastas', 'en:dry-pastas', 'en:spaghetti'],
  },
};

(async () => {
  const video = path.join(os.tmpdir(), 'novafit-ean.y4m');
  y4m('8076800195057', video);
  const server = http.createServer((req, res) => {
    const f = path.join(root, decodeURIComponent(req.url.split('?')[0]).replace(/^\/$/, '/index.html'));
    if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(res);
  }).listen(0);
  const url = 'http://localhost:' + server.address().port + '/';
  const b = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--use-file-for-fake-video-capture=' + video] });
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, permissions: ['camera'] });
  const p = await ctx.newPage();
  const errors = [];
  const check = (c, m) => { if (!c) errors.push(m); };
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error' && !/fonts\.g|favicon|404/.test(m.text())) errors.push(m.text()); });
  const offCalls = [];
  await p.route('https://world.openfoodfacts.org/**', (route) => {
    const u = route.request().url();
    offCalls.push(u);
    if (u.includes('8076800195057')) return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' }, body: JSON.stringify(OFF_PASTA) });
    return route.fulfill({ status: 404, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' }, body: '{"status":0}' });
  });
  await p.goto(url);
  await p.click('#profile-form button[type=submit]');
  await p.click('.nav-btn[data-tab=food]');
  const before = await p.evaluate(() => JSON.parse(localStorage.getItem('novafit.v1')).inventory.pasta || 0);

  // 1) камера → ZXing → Open Food Facts → «как Макароны»
  await p.click('[data-act=scan-open][data-mode=stock]');
  await p.waitForSelector('.scan-card', { timeout: 15000 });
  check(offCalls.some((u) => u.includes('8076800195057')), 'не было запроса в Open Food Facts');
  check(/Spaghetti/.test(await p.textContent('.scan-card')), 'товар не показан');
  check(await p.isChecked('input[name=scan-choice][value=base]'), 'не предложена привязка к «Макаронам»');
  check((await p.inputValue('#scan-qty')) === '500', 'не подставился вес упаковки');
  await p.click('[data-act=scan-save]');
  await p.waitForTimeout(400);
  const after = await p.evaluate(() => { const s = JSON.parse(localStorage.getItem('novafit.v1')); return { pasta: s.inventory.pasta || 0, code: s.barcodes['8076800195057'] }; });
  check(after.pasta === before + 500, 'макароны не добавились: ' + before + ' → ' + after.pasta);
  check(after.code === 'pasta', 'штрихкод не запомнился');

  // 2) ручной ввод неизвестного кода → свой продукт → запоминается
  await p.click('[data-act=scan-open][data-mode=stock]');
  await p.fill('#scan-code', '4607001771517');
  await p.click('[data-act=scan-find]');
  await p.waitForSelector('#scan-kcal');
  await p.fill('#scan-name', 'Кефир местный');
  await p.fill('#scan-kcal', '53'); await p.fill('#scan-p', '3'); await p.fill('#scan-f', '2.5'); await p.fill('#scan-c', '4');
  await p.selectOption('#scan-cat', 'dairy');
  await p.fill('#scan-qty', '900');
  await p.click('[data-act=scan-save]');
  await p.waitForTimeout(300);
  const custom = await p.evaluate(() => { const s = JSON.parse(localStorage.getItem('novafit.v1')); return { inv: s.inventory.b4607001771517, food: s.customFoods.find((f) => f.id === 'b4607001771517') }; });
  check(custom.inv === 900 && custom.food && custom.food.cat === 'dairy', 'свой продукт не сохранился');

  // 3) тот же код ещё раз — узнаётся без запроса в базу (работает офлайн)
  const callsBefore = offCalls.length;
  await p.click('[data-act=scan-open][data-mode=stock]');
  await p.fill('#scan-code', '4607001771517');
  await p.click('[data-act=scan-find]');
  await p.waitForSelector('.scan-card');
  check(/Кефир местный/.test(await p.textContent('.scan-card')), 'знакомый товар не узнан');
  check(offCalls.length === callsBefore, 'знакомый товар снова искался в интернете');
  await p.click('[data-act=scan-close]');

  // 4) неверная контрольная цифра
  await p.click('[data-act=scan-open][data-mode=stock]');
  await p.fill('#scan-code', '4607001771518');
  await p.click('[data-act=scan-find]');
  check(/не бывает/.test(await p.textContent('#scan-msg')), 'нет сообщения о неверном коде');
  await p.click('[data-act=scan-close]');

  // 5) «съел» по штрихкоду — в еду вне плана
  await p.click('.nav-btn[data-tab=today]');
  await p.click('.nav-fab');
  await p.click('.tile[data-sheet=eat]');
  await p.click('#sheet [data-act=scan-open][data-mode=extra]');
  await p.fill('#scan-code', '4607001771517');
  await p.click('[data-act=scan-find]');
  await p.waitForSelector('#scan-qty');
  await p.fill('#scan-qty', '250');
  await p.click('[data-act=scan-save]');
  await p.waitForTimeout(300);
  check(/Кефир местный/.test(await p.textContent('.tl-item.k-extra')), 'еда по штрихкоду не записалась');

  await b.close();
  server.close();
  fs.unlinkSync(video);
  if (errors.length) { console.log('ОШИБКИ:\n' + errors.join('\n')); process.exit(1); }
  console.log('scanner e2e: всё ок');
})();
