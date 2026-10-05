/**
 * 从矢量 logo.svg 生成三平台所需图标：
 *  - build/icon.png (1024)：electron-builder 在 macOS 上自动生成 .icns
 *  - build/icons/*.png    ：Linux (AppImage/deb) 多尺寸图标
 * 用法：node tools/gen-icons.cjs
 */
const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const SRC = path.join(__dirname, '..', 'public', 'logo.svg');
const BUILD = path.join(__dirname, '..', 'build');
const ICONS = path.join(BUILD, 'icons');
fs.mkdirSync(ICONS, { recursive: true });

(async () => {
  const base = sharp(SRC, { density: 384 }).resize(1024, 1024, {
    fit: 'contain',
    background: { r: 0, g: 0, b: 0, alpha: 0 },
  });

  await base.png().toFile(path.join(BUILD, 'icon.png'));
  console.log('wrote build/icon.png 1024x1024');

  const sizes = [16, 24, 32, 48, 64, 128, 256, 512, 1024];
  for (const s of sizes) {
    await base.clone().resize(s, s).png().toFile(path.join(ICONS, `${s}x${s}.png`));
  }
  console.log('wrote build/icons:', sizes.join(', '));
})().catch((e) => {
  console.error('GEN-ICONS ERR:', e);
  process.exit(1);
});
