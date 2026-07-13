/**
 * 离线发音包批量下载器
 *
 * 功能：
 * - 从词典数据库读取全部单词
 * - 逐个调用 TTS 下载发音并保存到 userData/assets/pronunciations
 * - 支持断点续传（退出后下次启动自动继续）
 * - 提供进度、暂停、取消接口
 */

import * as fs from 'fs';
import * as path from 'path';
import { USER_DATA_DIR, ASSETS_DIR, ensureDirExists, normalizeWordForFilename } from '../utils/helpers';
import { getMainDb } from './database';
import { getTTS } from './tts';

const STATE_FILE = path.join(USER_DATA_DIR, 'pronunciation-download-state.json');

const BATCH_SIZE = 20;
const CONCURRENCY = 2;

export interface PronunciationDownloadStatus {
  total: number;
  completed: number;
  failed: number;
  pending: number;
  inProgress: boolean;
  paused: boolean;
  percent: number;
  accent: string;
}

interface DownloadState {
  total: number;
  completed: number;
  failed: number;
  inProgress: boolean;
  paused: boolean;
  accent: 'us' | 'uk';
  pending: string[];
  failedWords: string[];
  lastUpdated: string;
}

const DEFAULT_STATE: DownloadState = {
  total: 0,
  completed: 0,
  failed: 0,
  inProgress: false,
  paused: false,
  accent: 'us',
  pending: [],
  failedWords: [],
  lastUpdated: new Date().toISOString(),
};

let activeLoopPromise: Promise<void> | null = null;

function loadState(): DownloadState {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const raw = fs.readFileSync(STATE_FILE, 'utf8');
      const parsed = JSON.parse(raw);
      return { ...DEFAULT_STATE, ...parsed };
    }
  } catch (e) {
    console.error('[pronunciation-downloader] 读取状态文件失败:', e);
  }
  return { ...DEFAULT_STATE };
}

function saveState(state: DownloadState): void {
  try {
    ensureDirExists(USER_DATA_DIR);
    const tmp = STATE_FILE + '.tmp';
    state.lastUpdated = new Date().toISOString();
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8');
    fs.renameSync(tmp, STATE_FILE);
  } catch (e) {
    console.error('[pronunciation-downloader] 保存状态文件失败:', e);
  }
}

function getAudioFilePath(word: string, accent: string): string {
  const filename = `${normalizeWordForFilename(word)}_${accent}.mp3`;
  return path.join(ASSETS_DIR, 'pronunciations', filename);
}

function isDownloaded(word: string, accent: string): boolean {
  const fp = getAudioFilePath(word, accent);
  try {
    return fs.existsSync(fp) && fs.statSync(fp).size > 100;
  } catch {
    return false;
  }
}

async function downloadOne(word: string, accent: string): Promise<boolean> {
  if (isDownloaded(word, accent)) return true;

  const tts = getTTS();
  if (!tts) {
    console.warn('[pronunciation-downloader] TTS 未初始化');
    return false;
  }

  try {
    const filepath = await tts.getPronunciation(word, accent, false);
    return !!filepath;
  } catch (e: any) {
    console.error(`[pronunciation-downloader] ${word} 下载失败:`, e.message || e);
    return false;
  }
}

async function runBatch(words: string[], accent: string): Promise<Array<{ word: string; success: boolean }>> {
  const results: Array<{ word: string; success: boolean }> = [];
  let index = 0;

  async function worker() {
    while (index < words.length) {
      const word = words[index++];
      const success = await downloadOne(word, accent);
      results.push({ word, success });
    }
  }

  const workers: Promise<void>[] = [];
  for (let i = 0; i < CONCURRENCY; i++) {
    workers.push(worker());
  }
  await Promise.all(workers);
  return results;
}

async function processLoop(): Promise<void> {
  if (activeLoopPromise) return activeLoopPromise;

  activeLoopPromise = (async () => {
    while (true) {
      const state = loadState();
      if (!state.inProgress || state.paused || state.pending.length === 0) {
        break;
      }

      const batch = state.pending.slice(0, BATCH_SIZE);
      const batchResults = await runBatch(batch, state.accent);

      // 重新加载状态，防止暂停/取消操作被覆盖
      const current = loadState();
      if (!current.inProgress || current.paused) break;

      const remaining = [...current.pending];
      let completed = current.completed;
      let failed = current.failed;
      const failedWords = [...current.failedWords];

      for (const { word, success } of batchResults) {
        const idx = remaining.indexOf(word);
        if (idx >= 0) remaining.splice(idx, 1);
        if (success) {
          completed++;
        } else {
          failed++;
          if (!failedWords.includes(word)) failedWords.push(word);
        }
      }

      const nextState: DownloadState = {
        ...current,
        completed,
        failed,
        pending: remaining,
        failedWords,
      };

      if (remaining.length === 0) {
        nextState.inProgress = false;
        nextState.paused = false;
      }

      saveState(nextState);
    }

    // 兜底：如果 pending 为空则自动结束
    const finalState = loadState();
    if (finalState.pending.length === 0 && (finalState.inProgress || finalState.paused)) {
      finalState.inProgress = false;
      finalState.paused = false;
      saveState(finalState);
    }
  })();

  try {
    await activeLoopPromise;
  } finally {
    activeLoopPromise = null;
  }
}

/** 开始/重新开始批量下载 */
export async function startBulkDownload(accent: 'us' | 'uk' = 'us'): Promise<void> {
  const db = getMainDb();
  if (!db) throw new Error('词典数据库未初始化');

  const allWords = db.getAllWords();
  const pending = allWords.filter(w => !isDownloaded(w, accent));

  const state: DownloadState = {
    ...DEFAULT_STATE,
    total: allWords.length,
    completed: allWords.length - pending.length,
    failed: 0,
    inProgress: true,
    paused: false,
    accent,
    pending,
    failedWords: [],
  };

  saveState(state);
  processLoop().catch(e => console.error('[pronunciation-downloader] 下载循环异常:', e));
}

/** 暂停下载 */
export function pauseBulkDownload(): void {
  const state = loadState();
  if (state.inProgress) {
    state.paused = true;
    saveState(state);
  }
}

/** 取消下载（保留已完成进度） */
export function cancelBulkDownload(): void {
  const state = loadState();
  state.inProgress = false;
  state.paused = false;
  saveState(state);
}

/** 清空离线发音包缓存（删除已下载文件并重置状态） */
export function clearPronunciationCache(): { success: boolean; message: string } {
  try {
    const dir = path.join(ASSETS_DIR, 'pronunciations');
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    if (fs.existsSync(STATE_FILE)) {
      fs.rmSync(STATE_FILE, { force: true });
    }
    return { success: true, message: '已清空离线发音包缓存' };
  } catch (e: any) {
    return { success: false, message: e.message || '清空失败' };
  }
}

/** 获取当前下载状态 */
export function getBulkDownloadStatus(): PronunciationDownloadStatus {
  const state = loadState();
  const dir = path.join(ASSETS_DIR, 'pronunciations');
  let downloadedCount = 0;
  try {
    if (fs.existsSync(dir)) {
      const files = fs.readdirSync(dir);
      downloadedCount = files.filter(f => f.endsWith('.mp3')).length;
    }
  } catch {}

  let totalWords = state.total;
  let completed = state.completed;

  // 如果 state 记录不可信（total 为 0 但已有文件），尝试从词典获取真实总数
  if ((totalWords === 0 || completed === 0) && downloadedCount > 0) {
    try {
      const db = getMainDb();
      if (db) {
        totalWords = db.getAllWords().length;
      }
    } catch {}
    completed = downloadedCount;
  } else if (totalWords > 0) {
    completed = Math.max(state.completed, totalWords - state.pending.length, downloadedCount);
  }

  if (totalWords === 0 && downloadedCount > 0) {
    totalWords = Math.max(downloadedCount, state.pending.length + downloadedCount);
  }

  const done = totalWords > 0 ? Math.min(completed, totalWords) : downloadedCount;
  const percent = totalWords > 0 ? Math.round((done / totalWords) * 1000) / 10 : (downloadedCount > 0 ? 100 : 0);

  return {
    total: totalWords,
    completed: done,
    failed: state.failed,
    pending: state.pending.length,
    inProgress: state.inProgress && !state.paused,
    paused: state.paused,
    percent,
    accent: state.accent,
  };
}

function hasDownloadedAnyPronunciation(): boolean {
  const dir = path.join(ASSETS_DIR, 'pronunciations');
  try {
    if (!fs.existsSync(dir)) return false;
    const files = fs.readdirSync(dir);
    return files.some(f => f.endsWith('.mp3'));
  } catch {
    return false;
  }
}

/** 应用启动时调用：
 * 1. 如果上回正在下载，直接继续；
 * 2. 如果已有发音文件或还有 pending，后台扫描缺失并补下。
 */
export function autoResumePronunciationDownloads(): void {
  const state = loadState();

  // 情况 1：上次退出时仍在下载中
  if (state.inProgress && !state.paused && state.pending.length > 0) {
    console.log(`[pronunciation-downloader] 检测到未完成的下载任务，自动继续：${state.pending.length} 个单词待下载`);
    processLoop().catch(e => console.error('[pronunciation-downloader] 自动继续异常:', e));
    return;
  }

  // 情况 2：后台检查缺失（用户取消过、文件被删、或之前下载过一部分）
  if (state.pending.length > 0 || hasDownloadedAnyPronunciation()) {
    const db = getMainDb();
    if (!db) {
      console.warn('[pronunciation-downloader] 词典未初始化，跳过后台检查');
      return;
    }

    const accent = state.accent || 'us';
    const allWords = db.getAllWords();
    const missing = allWords.filter(w => !isDownloaded(w, accent));

    if (missing.length === 0) {
      console.log('[pronunciation-downloader] 后台检查完成，无缺失发音文件');
      return;
    }

    console.log(`[pronunciation-downloader] 后台检查发现 ${missing.length} 个缺失发音文件，开始补下`);

    const newState: DownloadState = {
      ...state,
      total: allWords.length,
      completed: allWords.length - missing.length,
      pending: missing,
      failed: 0,
      failedWords: [],
      inProgress: true,
      paused: false,
      accent,
    };
    saveState(newState);
    processLoop().catch(e => console.error('[pronunciation-downloader] 后台补下异常:', e));
  }
}
