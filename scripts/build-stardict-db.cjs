const path = require('path');
const { app } = require('electron');
const { buildStardictDbFromCsvs } = require('../electron-dist/services/database');

const outputPath = process.argv[2] || path.join(app.getPath('userData'), 'stardict.db');

app.whenReady().then(async () => {
  try {
    console.log('开始从 CSV 生成 stardict.db...');
    console.log('输出路径:', outputPath);
    await buildStardictDbFromCsvs(outputPath);
    console.log('生成完成:', outputPath);
    app.quit(0);
  } catch (err) {
    console.error('生成失败:', err);
    app.quit(1);
  }
});
