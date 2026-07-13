/**
 * 离线发音包批量下载器
 *
 * 功能：
 * - 从词典数据库读取全部单词
 * - 逐个调用 TTS 下载发音并保存到 userData/assets/pronunciations
 * - 支持断点续传（退出后下次启动自动继续未完成的下载）
 * - 提供进度、暂停、取消接口
 * - 启动时扫描检测已下载文件，清理中文发音文件
 */

import * as fs from 'fs';
import * as path from 'path';
import { USER_DATA_DIR, ASSETS_DIR, ensureDirExists, normalizeWordForFilename } from '../utils/helpers';
import { getMainDb } from './database';
import { getTTS } from './tts';

const STATE_FILE = path.join(USER_DATA_DIR, 'pronunciation-download-state.json');
const PRONUNCIATIONS_DIR = path.join(ASSETS_DIR, 'pronunciations');

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

function hasChinese(text: string): boolean {
  return /[\u4e00-\u9fa5]/.test(text);
}

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
  return path.join(PRONUNCIATIONS_DIR, filename);
}

function isDownloaded(word: string, accent: string): boolean {
  const fp = getAudioFilePath(word, accent);
  try {
    return fs.existsSync(fp) && fs.statSync(fp).size > 100;
  } catch {
    return false;
  }
}

function getMp3FilesForAccent(accent: string): string[] {
  try {
    if (!fs.existsSync(PRONUNCIATIONS_DIR)) return [];
    const suffix = `_${accent}.mp3`;
    const allFiles = fs.readdirSync(PRONUNCIATIONS_DIR);
    return allFiles.filter(f => f.endsWith(suffix) && f.length > suffix.length + 1);
  } catch {
    return [];
  }
}

function countDownloadedForAccent(accent: string): number {
  return getMp3FilesForAccent(accent).length;
}

function cleanupChinesePronunciationFiles(): number {
  let cleaned = 0;
  try {
    if (!fs.existsSync(PRONUNCIATIONS_DIR)) return 0;
    const files = fs.readdirSync(PRONUNCIATIONS_DIR);
    for (const file of files) {
      const baseName = file.replace(/_(us|uk)\.mp3$/, '');
      if (hasChinese(baseName)) {
        try {
          fs.unlinkSync(path.join(PRONUNCIATIONS_DIR, file));
          const providerFile = path.join(PRONUNCIATIONS_DIR, file + '.provider');
          if (fs.existsSync(providerFile)) fs.unlinkSync(providerFile);
          cleaned++;
        } catch (e) {
          console.error('[pronunciation-downloader] 删除中文发音文件失败:', file, e);
        }
      }
    }
  } catch (e) {
    console.error('[pronunciation-downloader] 清理中文发音文件出错:', e);
  }
  if (cleaned > 0) {
    console.log(`[pronunciation-downloader] 已清理 ${cleaned} 个中文发音文件`);
  }
  return cleaned;
}

async function downloadOne(word: string, accent: string): Promise<boolean> {
  if (isDownloaded(word, accent)) return true;

  if (hasChinese(word)) return false;

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

export async function startBulkDownload(accent: 'us' | 'uk' = 'us'): Promise<void> {
  const db = getMainDb();
  if (!db) throw new Error('词典数据库未初始化');

  cleanupChinesePronunciationFiles();

  const allWords = db.getAllWords().filter(w => !hasChinese(w));
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

export function pauseBulkDownload(): void {
  const state = loadState();
  if (state.inProgress) {
    state.paused = true;
    saveState(state);
  }
}

export function cancelBulkDownload(): void {
  const state = loadState();
  state.inProgress = false;
  state.paused = false;
  state.pending = [];
  state.failedWords = [];
  state.failed = 0;
  saveState(state);
}

export function clearPronunciationCache(): { success: boolean; message: string } {
  try {
    if (fs.existsSync(PRONUNCIATIONS_DIR)) {
      fs.rmSync(PRONUNCIATIONS_DIR, { recursive: true, force: true });
    }
    if (fs.existsSync(STATE_FILE)) {
      fs.rmSync(STATE_FILE, { force: true });
    }
    return { success: true, message: '已清空离线发音包缓存' };
  } catch (e: any) {
    return { success: false, message: e.message || '清空失败' };
  }
}

export function getBulkDownloadStatus(): PronunciationDownloadStatus {
  const state = loadState();

  cleanupChinesePronunciationFiles();

  const accent = state.accent || 'us';
  const dirExists = fs.existsSync(PRONUNCIATIONS_DIR);
  let downloadedCount = 0;

  if (dirExists) {
    downloadedCount = countDownloadedForAccent(accent);
  }

  let dbTotal = 0;
  try {
    const db = getMainDb();
    if (db) {
      dbTotal = db.getAllWords().filter(w => !hasChinese(w)).length;
    }
  } catch {}

  let totalWords: number;
  let completed: number;

  if (state.inProgress || state.paused || (state.total > 0 && state.pending.length > 0)) {
    totalWords = state.total > 0 ? state.total : Math.max(dbTotal, downloadedCount + state.pending.length);
    completed = Math.max(state.completed, downloadedCount, totalWords - state.pending.length);
  } else if (state.total > 0 && state.completed > 0) {
    totalWords = state.total;
    completed = Math.max(state.completed, downloadedCount);
    if (dbTotal > 0 && dbTotal !== totalWords) {
      totalWords = dbTotal;
      completed = downloadedCount;
    }
  } else if (downloadedCount > 0) {
    totalWords = dbTotal > 0 ? dbTotal : downloadedCount;
    completed = downloadedCount;
  } else {
    totalWords = dbTotal;
    completed = 0;
  }

  if (totalWords > 0 && completed > totalWords) {
    completed = totalWords;
  }

  const percent = totalWords > 0
    ? Math.round((completed / totalWords) * 1000) / 10
    : (downloadedCount > 0 ? 100 : 0);

  const isAllDownloaded = totalWords > 0 && completed >= totalWords && !state.inProgress && !state.paused;

  return {
    total: totalWords,
    completed: isAllDownloaded ? totalWords : completed,
    failed: state.failed,
    pending: state.inProgress || state.paused ? state.pending.length : 0,
    inProgress: state.inProgress && !state.paused,
    paused: state.paused,
    percent: isAllDownloaded ? 100 : percent,
    accent,
  };
}

export function autoResumePronunciationDownloads(): void {
  cleanupChinesePronunciationFiles();

  const state = loadState();

  if (state.inProgress && !state.paused && state.pending.length > 0) {
    console.log(`[pronunciation-downloader] 检测到未完成的下载任务，自动继续：${state.pending.length} 个单词待下载`);
    processLoop().catch(e => console.error('[pronunciation-downloader] 自动继续异常:', e));
    return;
  }

  if (state.paused && state.pending.length > 0) {
    console.log(`[pronunciation-downloader] 检测到已暂停的下载任务（${state.pending.length} 个待下载），等待用户手动继续`);
    return;
  }

  if (!state.inProgress && !state.paused && state.pending.length > 0) {
    state.pending = [];
    state.failedWords = [];
    state.failed = 0;
    saveState(state);
  }

  if (state.total > 0) {
    const accent = state.accent || 'us';
    const downloadedCount = countDownloadedForAccent(accent);
    if (downloadedCount !== state.completed || downloadedCount >= state.total) {
      state.completed = downloadedCount;
      if (downloadedCount >= state.total && state.total > 0) {
        state.inProgress = false;
        state.paused = false;
        state.pending = [];
        state.failed = 0;
        state.failedWords = [];
      }
      saveState(state);
    }
  }

  console.log('[pronunciation-downloader] 启动检查完成');
}
