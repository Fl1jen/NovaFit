// node tools/build-single.js [out.html] — собирает всё приложение в один HTML-файл
// (удобно отправить себе на телефон или открыть без сервера).
const fs = require('fs'); const path = require('path');
const root = path.join(__dirname, '..');
const out = process.argv[2] || path.join(root, 'dist', 'novafit.html');
let html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
html = html.replace(/<link rel="stylesheet" href="styles.css">/, () => '<style>\n' + fs.readFileSync(path.join(root, 'styles.css'), 'utf8') + '</style>');
html = html.replace(/<script src="(js\/[^"]+)"><\/script>/g, (_, f) => '<script>\n' + fs.readFileSync(path.join(root, f), 'utf8') + '</script>');
html = html.replace(/<link rel="(manifest|icon|apple-touch-icon)"[^>]*>\n/g, '');
html = html.replace('<script>', '<script>window.__NF_EMBED = true;</script>\n<script>');
if (process.argv.includes('--fragment')) {
  // для встраивания: без doctype/html/head/body
  html = html.replace(/<!doctype html>\n<html[^>]*>\n<head>\n/, '').replace(/<meta charset[^>]*>\n<meta name="viewport"[^>]*>\n/, '')
    .replace('</head>\n<body>\n', '').replace('</body>\n</html>\n', '');
}
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, html);
console.log('→', out, (html.length / 1024).toFixed(0) + ' КБ');
