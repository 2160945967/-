/**
 * 轻量本地日志：写入 userData/logs/app.log，按大小轮转。
 * 不依赖 electron API（fork 子进程也可使用）。
 */

import * as fs from 'fs';
import * as path from 'path';
import { USER_DATA_DIR } from '../utils/helpers';
import { ensureDirExists } from '../utils/helpers';

export type LogLevel = 'INFO' | 'WARN' | 'ERROR';

const LOG_DIR = path.join(USER_DATA_DIR, 'logs');
const LOG_FILE = path.join(LOG_DIR, 'app.log');
const OLD_FILE = path.join(LOG_DIR, 'app.old.log');
const MAX_BYTES = 2 * 1024 * 1024; // 单文件 2MB，超出滚动为 app.old.log

function rotateIfNeeded(): void {
  try {
    if (fs.existsSync(LOG_FILE) && fs.statSync(LOG_FILE).size > MAX_BYTES) {
      try { if (fs.existsSync(OLD_FILE)) fs.unlinkSync(OLD_FILE); } catch { /* ignore */ }
      fs.renameSync(LOG_FILE, OLD_FILE);
    }
  } catch { /* ignore */ }
}

export function log(level: LogLevel, message: string): void {
  try {
    ensureDirExists(LOG_DIR);
    rotateIfNeeded();
    const line = `[${new Date().toISOString()}] [${level}] ${message}\n`;
    fs.appendFileSync(LOG_FILE, line, 'utf8');
  } catch { /* ignore */ }
}

let installed = false;

/** 注册主 / 子进程级别的全局异常捕获 */
export function initProcessLogging(source: string = 'main'): void {
  if (installed) return;
  installed = true;
  log('INFO', `${source} 进程启动`);
  process.on('uncaughtException', (e: any) => {
    log('ERROR', `[${source}] 未捕获异常: ${e?.stack || e}`);
  });
  process.on('unhandledRejection', (e: any) => {
    log('ERROR', `[${source}] 未处理 Promise: ${e?.stack || e}`);
  });
}

export function getLogFilePath(): string {
  return LOG_FILE;
}
