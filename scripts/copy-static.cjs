/**
 * 复制 dist/ 文件到 static/
 * Vite 构建后自动执行
 */
const fs = require('fs');
const path = require('path');

const distDir = path.join(__dirname, '..', 'dist');
const staticDir = path.join(__dirname, '..', 'static');

function copyRecursive(src, dest) {
  if (!fs.existsSync(src)) return;
  
  if (fs.statSync(src).isDirectory()) {
    if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src)) {
      copyRecursive(path.join(src, entry), path.join(dest, entry));
    }
  } else {
    fs.copyFileSync(src, dest);
  }
}

// 先清空 static/，避免旧文件残留
if (fs.existsSync(staticDir)) {
  fs.rmSync(staticDir, { recursive: true, force: true });
}
console.log('正在复制 dist/ → static/ ...');
copyRecursive(distDir, staticDir);
console.log('复制完成');

// 在 electron-dist/ 里放 package.json 覆盖 type:module，让编译出的 CJS 代码正常运行
const electronDistDir = path.join(__dirname, '..', 'electron-dist');
if (!fs.existsSync(electronDistDir)) fs.mkdirSync(electronDistDir, { recursive: true });
fs.writeFileSync(
  path.join(electronDistDir, 'package.json'),
  JSON.stringify({ type: 'commonjs' }, null, 2)
);
console.log('已写入 electron-dist/package.json');