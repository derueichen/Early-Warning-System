// 將 index.html + style.css + ews.js + app.js 打包成單一 HTML
// 用法：node scripts/build-artifact.js
//   dist/ews-calculator.html          claude.ai Artifact 用（Excel 程式庫由 CDN 載入）
//   dist/ews-calculator-offline.html  完整離線版，可直接傳檔給別人，雙擊即可用
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const XLSX_CDN = 'https://cdn.jsdelivr.net/npm/xlsx-js-style@1.2.0/dist/xlsx.bundle.js';

const html = read('index.html');
const title = html.match(/<title>.*?<\/title>/)[0];
const inline = (file) => `<script>\n${read(file).replace(/<\/script/gi, '<\\/script')}\n</script>`;
const body = (xlsxTag) => html.match(/<body>([\s\S]*)<\/body>/)[1]
  .replace(/<script src="vendor\/xlsx\.bundle\.js"><\/script>/, () => xlsxTag)
  .replace(/<script src="ews\.js"><\/script>/, () => inline('ews.js'))
  .replace(/<script src="app\.js"><\/script>/, () => inline('app.js'))
  .trim();
const style = `<style>\n${read('style.css')}</style>`;

const outputs = {
  // Artifact 會自動包上 <!doctype html><head>…，這裡只放內容
  'ews-calculator.html': `${title}\n${style}\n${body(`<script src="${XLSX_CDN}"></script>`)}\n`,
  'ews-calculator-offline.html': `<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${title}
${style}
</head>
<body>
${body(inline('vendor/xlsx.bundle.js'))}
</body>
</html>
`,
};
fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
for (const [name, out] of Object.entries(outputs)) {
  fs.writeFileSync(path.join(root, 'dist', name), out);
  console.log(`dist/${name}`, out.length, 'bytes');
}
