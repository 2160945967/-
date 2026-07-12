// 下载 Vosk 英文小模型 (~43MB)
const https = require('https');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const MODEL_URL = 'https://alphacephei.com/vosk/models/vosk-model-small-en-us-0.15.zip';
const MODEL_DIR = path.join(process.cwd(), 'vosk-model-small-en-us-0.15');

if (fs.existsSync(MODEL_DIR)) {
    console.log('模型已存在，跳过下载');
    process.exit(0);
}

const zipPath = path.join(process.cwd(), 'vosk-model.zip');

console.log('正在下载 Vosk 英文模型 (~43MB)...');

https.get(MODEL_URL, (res) => {
    if (res.statusCode === 302 || res.statusCode === 301) {
        https.get(res.headers.location, doDownload);
        return;
    }
    doDownload(res);
}).on('error', (err) => {
    console.error('下载失败:', err.message);
    console.log('请手动下载模型:');
    console.log('  ' + MODEL_URL);
    console.log('解压到项目根目录，文件夹名: vosk-model-small-en-us-0.15');
    process.exit(1);
});

function doDownload(res) {
    const total = parseInt(res.headers['content-length'] || '0', 10);
    let downloaded = 0;
    const file = fs.createWriteStream(zipPath);

    res.on('data', (chunk) => {
        downloaded += chunk.length;
        if (total > 0) {
            process.stdout.write(`\r下载进度: ${(downloaded / total * 100).toFixed(1)}%`);
        }
    });

    res.pipe(file);

    file.on('finish', () => {
        file.close(() => {
            // 等 close 回调完成后再解压，避免文件被占用
            setTimeout(() => {
                try {
                    const { execSync } = require('child_process');
                    execSync(`powershell -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${process.cwd()}' -Force"`, { stdio: 'inherit' });
                    fs.unlinkSync(zipPath);
                    console.log('解压完成！模型路径:', MODEL_DIR);
                } catch (e) {
                    console.error('解压失败:', e.message);
                    console.log('请手动解压', zipPath, '到项目根目录');
                }
            }, 500);
        });
    });
}
