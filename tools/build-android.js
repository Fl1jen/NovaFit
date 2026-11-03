// node tools/build-android.js — готовит веб-часть для APK:
// копирует приложение в android/app/src/main/assets/www и встраивает шрифты,
// чтобы всё работало без интернета. Потом: cd android && gradle assembleRelease
const fs = require('fs');
const path = require('path');
const https = require('https');
const root = path.join(__dirname, '..');
const fontsDir = path.join(root, 'android', 'fonts');
const www = path.join(root, 'android', 'app', 'src', 'main', 'assets', 'www');
const FONT_CSS = 'https://fonts.googleapis.com/css2?family=Golos+Text:wght@400;500;600;700&family=Unbounded:wght@500;700&display=swap';
const UA = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36';

function get(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': UA } }, (res) => {
      if (res.statusCode !== 200) return reject(new Error(url + ' → ' + res.statusCode));
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    }).on('error', reject);
  });
}

async function ensureFonts() {
  const cssPath = path.join(fontsDir, 'fonts.css');
  if (fs.existsSync(cssPath)) return;
  fs.mkdirSync(fontsDir, { recursive: true });
  let css = (await get(FONT_CSS)).toString('utf8');
  // нужны только кириллица и латиница
  const blocks = css.split(/(?=\/\* [\w-]+ \*\/)/).filter((b) => /^\/\* (cyrillic|latin) \*\//.test(b));
  css = blocks.join('');
  const urls = [...new Set(css.match(/https:\/\/fonts\.gstatic\.com\/[^)]+/g))];
  for (const u of urls) {
    const name = u.split('/').slice(-3).join('_').replace(/[^\w.]/g, '_');
    fs.writeFileSync(path.join(fontsDir, name), await get(u));
    css = css.split(u).join(name);
  }
  fs.writeFileSync(cssPath, '/* Golos Text, Unbounded — SIL Open Font License 1.1 (Google Fonts) */\n' + css);
  console.log('шрифты:', urls.length, 'файлов');
}

function copy(src, dst) {
  const st = fs.statSync(src);
  if (st.isDirectory()) { fs.mkdirSync(dst, { recursive: true }); fs.readdirSync(src).forEach((f) => copy(path.join(src, f), path.join(dst, f))); }
  else fs.copyFileSync(src, dst);
}

(async () => {
  await ensureFonts();
  fs.rmSync(www, { recursive: true, force: true });
  fs.mkdirSync(www, { recursive: true });
  let html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  html = html
    .replace(/<link rel="preconnect"[^>]*>\n/g, '')
    .replace(/<link rel="stylesheet" href="https:\/\/fonts\.googleapis\.com[^>]*>/, '<link rel="stylesheet" href="fonts/fonts.css">')
    .replace(/<link rel="manifest"[^>]*>\n/, '');
  fs.writeFileSync(path.join(www, 'index.html'), html);
  copy(path.join(root, 'styles.css'), path.join(www, 'styles.css'));
  copy(path.join(root, 'js'), path.join(www, 'js'));
  copy(path.join(root, 'icons'), path.join(www, 'icons'));
  copy(fontsDir, path.join(www, 'fonts'));
  console.log('→', path.relative(root, www));
})().catch((e) => { console.error(e); process.exit(1); });
