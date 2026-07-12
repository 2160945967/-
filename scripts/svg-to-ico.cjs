const sharp = require('sharp');
const fs = require('fs');

async function main() {
  const { default: pngToIco } = await import('png-to-ico');
  const sizes = [16, 32, 48, 64, 128, 256];
  const pngFiles = [];
  for (const size of sizes) {
    const file = `logo-${size}.png`;
    await sharp('dist/logo.svg')
      .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toFile(file);
    pngFiles.push(file);
  }
  const buf = await pngToIco(pngFiles);
  fs.writeFileSync('logo.ico', buf);
  for (const f of pngFiles) fs.unlinkSync(f);
  console.log('logo.ico 已生成');
}

main().catch(err => {
  console.error('生成失败:', err);
  process.exit(1);
});
