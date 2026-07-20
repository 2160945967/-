import express from 'express';
import * as path from 'path';
import * as fs from 'fs';
import * as net from 'net';
import { initDatabases } from './services/database';
import { initTTS } from './services/tts';
import { setupRoutes, warmSystemWordbooksCache } from './api/routes';
import { ROOT_DIR, APP_ROOT_DIR, CACHE_DIR, USER_DATA_DIR, ASSETS_DIR, resolveAssetPath } from './utils/helpers';
import { downloadRequiredAssets } from './services/asset-manager';
import { autoResumePronunciationDownloads } from './services/pronunciation-downloader';
import { preloadModel as preloadSemanticModel } from './services/semanticSimilarity';

// 将子进程 stdout/stderr 重定向到日志文件，避免 GUI 模式下无 stdout 导致 EPIPE 弹窗
const SERVER_LOG_PATH = path.join(USER_DATA_DIR, 'server.log');
if (!fs.existsSync(USER_DATA_DIR)) {
  fs.mkdirSync(USER_DATA_DIR, { recursive: true });
}
const serverLogStream = fs.createWriteStream(SERVER_LOG_PATH, { flags: 'a' });
function writeServerLog(level: string, ...args: any[]): void {
  const line = `[${new Date().toISOString()}] [${level}] ${args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ')}\n`;
  serverLogStream.write(line);
}
console.log = (...args: any[]) => writeServerLog('INFO', ...args);
console.error = (...args: any[]) => writeServerLog('ERROR', ...args);
console.warn = (...args: any[]) => writeServerLog('WARN', ...args);

const STATIC_DIR = path.join(APP_ROOT_DIR, 'dist');
// 发音文件统一写入用户数据目录；读取时优先用户目录，再回退安装目录
const PRONUNCIATIONS_DIR = path.join(ASSETS_DIR, 'pronunciations');
export function findPronunciationFile(filename: string): string | null {
  const userFile = path.join(ASSETS_DIR, 'pronunciations', filename);
  if (fs.existsSync(userFile)) return userFile;
  const bundledFile = path.join(ROOT_DIR, 'pronunciations', filename);
  if (fs.existsSync(bundledFile)) return bundledFile;
  return null;
}

function findAvailablePort(startPort: number): Promise<number> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.listen(startPort, '127.0.0.1', () => {
      const port = (server.address() as net.AddressInfo).port;
      server.close(() => resolve(port));
    });
    server.on('error', () => {
      resolve(findAvailablePort(startPort + 1));
    });
  });
}

async function start() {
  [ASSETS_DIR, PRONUNCIATIONS_DIR, CACHE_DIR].forEach(dir => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  });

  // 下载启动必需的资源（如词典数据库），缺失时阻塞启动
  try {
    await downloadRequiredAssets();
  } catch (e: any) {
    console.error('下载必需资源失败:', e.message);
    // 继续尝试初始化，让应用给出友好提示而不是直接崩溃
  }

  await initDatabases();

  setTimeout(() => warmSystemWordbooksCache(), 0);

  initTTS(PRONUNCIATIONS_DIR, CACHE_DIR);

  // 启动后在后台异步检查/继续未完成的离线发音包下载，避免阻塞事件循环
  setTimeout(() => {
    autoResumePronunciationDownloads().catch(e => console.error('启动时恢复发音下载失败:', e));
  }, 0);

  // 预加载语义相似度模型（在后台异步加载，不阻塞启动）
  setTimeout(() => {
    preloadSemanticModel().catch(e => console.error('预加载语义模型失败:', e));
  }, 1000);

  const app = express();

  // 只允许本机 127.0.0.1 访问
  app.use((req, res, next) => {
    const ip = req.ip || req.socket.remoteAddress || '';
    if (ip !== '127.0.0.1' && ip !== '::1' && ip !== '::ffff:127.0.0.1') {
      res.status(403).json({ success: false, error: { message: 'Forbidden', statusCode: 403 } });
      return;
    }
    next();
  });

  setupRoutes(app);

  app.use(express.static(STATIC_DIR));

  const PORT = await findAvailablePort(5000);
  const server = app.listen(PORT, '127.0.0.1', () => {
    console.log(`Server running on http://127.0.0.1:${PORT}`);
    // 仅在被 fork 为子进程时才发送 ready 消息
    if (typeof process.send === 'function') {
      process.send({ type: 'ready', port: PORT });
    }
  });

  server.on('error', (err: any) => {
    console.error('Server error:', err);
  });

  process.on('message', (msg: any) => {
    if (msg === 'shutdown') {
      server.close(() => process.exit(0));
    }
  });
}

start().catch(err => {
  console.error('Server start failed:', err);
  serverLogStream.end(() => process.exit(1));
});