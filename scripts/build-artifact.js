// 將 index.html + style.css + ews.js + app.js 打包成單一 HTML（供 claude.ai Artifact 發佈分享）
// 用法：node scripts/build-artifact.js  →  dist/ews-calculator.html
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const XLSX_CDN = 'https://cdn.jsdelivr.net/npm/xlsx-js-style@1.2.0/dist/xlsx.bundle.js';

const html = read('index.html');
const title = html.match(/<title>.*?<\/title>/)[0];
const body = html.match(/<body>([\s\S]*)<\/body>/)[1]
  .replace(/<script src="vendor\/xlsx\.bundle\.js"><\/script>/, `<script src="${XLSX_CDN}"></script>`)
  .replace(/<script src="ews\.js"><\/script>/, () => `<script>\n${read('ews.js')}</script>`)
  .replace(/<script src="app\.js"><\/script>/, () => `<script>\n${read('app.js')}</script>`);

const out = `${title}\n<style>\n${read('style.css')}</style>\n${body.trim()}\n`;
fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
fs.writeFileSync(path.join(root, 'dist', 'ews-calculator.html'), out);
console.log('dist/ews-calculator.html', out.length, 'bytes');
