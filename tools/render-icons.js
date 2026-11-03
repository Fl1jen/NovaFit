// node tools/render-icons.js — делает PNG-иконки из icons/icon.svg
const { chromium } = require('playwright');
const fs = require('fs'); const path = require('path');
(async () => {
  const svg = fs.readFileSync(path.join(__dirname, '../icons/icon.svg'), 'utf8');
  const b = await chromium.launch();
  for (const s of [192, 512]) {
    const p = await b.newPage({ viewport: { width: s, height: s } });
    await p.setContent('<style>html,body{margin:0}svg{width:' + s + 'px;height:' + s + 'px;display:block}</style>' + svg);
    await p.screenshot({ path: path.join(__dirname, '../icons/icon-' + s + '.png'), omitBackground: true });
  }
  await b.close();
})();
