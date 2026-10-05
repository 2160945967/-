#!/usr/bin/env node
/**
 * 离线安装包资源准备脚本（CI / 本地均可运行）
 *
 * 从 Gitee Release V2.0 下载四组 7z 分卷，解压并放置到 electron-builder 期望位置：
 *   stardict.db                          -> ./stardict.db
 *   examples.db                          -> ./resource/examples.db
 *   sherpa-onnx-sense-voice-zh-en-ja-ko-yue -> ./resource/<dir>
 *   semantic-model-files                 -> ./resource/<dir>
 *
 * 特性：
 *   - 幂等：目标已存在则跳过，可重复运行；
 *   - 分卷断点：分卷文件已存在且大小匹配则跳过下载；
 *   - 失败自动重试（指数退避）；
 *   - 跨平台：统一使用 7zip-bin 自带的 7za 解压。
 *
 * 可用环境变量：
 *   ASSETS_BASE_URL  覆盖资源下载基地址（默认 Gitee V2.0）
 *   SEVENZA_BIN      手动指定 7za 可执行文件路径
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const { spawnSync } = require('child_process');

let path7za = '';
try {
  ({ path7za } = require('7zip-bin'));
} catch {
  path7za = process.env.SEVENZA_BIN || '';
}

const ROOT = process.cwd();
const DL_DIR = path.join(ROOT, '.offline-dl');
const BASE =
  process.env.ASSETS_BASE_URL ||
  'https://gitee.com/yangs-project/pick-up-words/releases/download/V2.0';
const VOL = 99_614_720; // 标准分卷 95MB

const RESOURCES = [
  {
    id: 'stardict',
    parts: [
      ['stardict.7z.001', VOL],
      ['stardict.7z.002', 56_979_524],
    ],
    place: [['stardict.db', path.join(ROOT, 'stardict.db')]],
  },
  {
    id: 'examples',
    parts: [
      ['examples.7z.001', VOL],
      ['examples.7z.002', VOL],
      ['examples.7z.003', 6_270_361],
    ],
    place: [['examples.db', path.join(ROOT, 'resource', 'examples.db')]],
  },
  {
    id: 'sherpa',
    parts: [
      ['sherpa-model.7z.001', VOL],
      ['sherpa-model.7z.002', 54_759_337],
    ],
    place: [
      [
        'sherpa-onnx-sense-voice-zh-en-ja-ko-yue',
        path.join(ROOT, 'resource', 'sherpa-onnx-sense-voice-zh-en-ja-ko-yue'),
      ],
    ],
  },
  {
    id: 'semantic',
    parts: [
      ['semantic-model.7z.001', 104_857_600],
      ['semantic-model.7z.002', 104_857_600],
      ['semantic-model.7z.003', 104_857_600],
      ['semantic-model.7z.004', 59_997_980],
    ],
    place: [
      ['semantic-model-files', path.join(ROOT, 'resource', 'semantic-model-files')],
    ],
  },
];

function download(url, dest, expectedSize, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (fs.existsSync(dest) && fs.statSync(dest).size === expectedSize) {
      return resolve();
    }
    const client = url.startsWith('https:') ? https : http;
    const req = client.get(
      url,
      { headers: { 'User-Agent': 'shici-offline-prep/2.0' } },
      (res) => {
        if ([301, 302, 307, 308].includes(res.statusCode)) {
          if (redirects > 8) return reject(new Error('too many redirects'));
          res.resume();
          return resolve(
            download(
              new URL(res.headers.location, url).toString(),
              dest,
              expectedSize,
              redirects + 1
            )
          );
        }
        if (res.statusCode !== 200) {
          return reject(new Error(`HTTP ${res.statusCode}: ${url}`));
        }
        const tmp = dest + '.tmp';
        const ws = fs.createWriteStream(tmp);
        res.pipe(ws);
        ws.on('finish', () =>
          ws.close(() => {
            const got = fs.statSync(tmp).size;
            if (expectedSize && got !== expectedSize) {
              return reject(new Error(`size mismatch ${path.basename(dest)} got ${got} expect ${expectedSize}`));
            }
            fs.renameSync(tmp, dest);
            resolve();
          })
        );
        ws.on('error', reject);
      }
    );
    req.setTimeout(60_000, () => req.destroy(new Error('socket timeout')));
    req.on('error', reject);
  });
}

async function withRetry(fn, label, tries = 5) {
  let last;
  for (let i = 1; i <= tries; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      console.log(`[retry ${i}/${tries}] ${label}: ${e.message}`);
      await new Promise((r) => setTimeout(r, 2000 * i));
    }
  }
  throw last;
}

(async () => {
  fs.mkdirSync(DL_DIR, { recursive: true });
  fs.mkdirSync(path.join(ROOT, 'resource'), { recursive: true });

  for (const r of RESOURCES) {
    const allPlaced = r.place.every(([, dst]) => fs.existsSync(dst));
    if (allPlaced) {
      console.log(`[skip] ${r.id} 已就位`);
      continue;
    }

    const partDir = path.join(DL_DIR, r.id);
    fs.mkdirSync(partDir, { recursive: true });

    for (const [name, size] of r.parts) {
      const dest = path.join(partDir, name);
      await withRetry(() => download(`${BASE}/${name}`, dest, size), name);
      console.log(`[got] ${name}`);
    }

    const extractDir = path.join(DL_DIR, `${r.id}-extract`);
    fs.mkdirSync(extractDir, { recursive: true });

    const bin = path7za;
    if (!bin || !fs.existsSync(bin)) {
      throw new Error('找不到 7za（可设置 SEVENZA_BIN）');
    }
    const first = path.join(partDir, r.parts[0][0]);
    const res = spawnSync(bin, ['x', '-y', `-o${extractDir}`, first], {
      stdio: 'inherit',
    });
    if (res.status !== 0) throw new Error(`解压失败: ${r.id}`);

    for (const [src, dst] of r.place) {
      const from = path.join(extractDir, src);
      if (!fs.existsSync(from)) throw new Error(`解压结果中缺少 ${from}`);
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      if (fs.existsSync(dst)) fs.rmSync(dst, { recursive: true, force: true });
      fs.renameSync(from, dst);
      console.log(`[placed] ${path.relative(ROOT, dst)}`);
    }

    fs.rmSync(partDir, { recursive: true, force: true });
    fs.rmSync(extractDir, { recursive: true, force: true });
  }

  fs.rmSync(DL_DIR, { recursive: true, force: true });
  console.log('离线资源全部就绪');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
