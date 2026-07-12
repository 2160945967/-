import * as path from 'path';
import * as fs from 'fs';
import { Request, Response } from 'express';
import {
  getMainDb, getExamplesDb, getExamplesDbPath, getLemmaDB,
  getWordRootDB, getResembleDB, getWordEnhancedInfo,
  findExamplesForWord
} from '../services/database';
import { getTTS } from '../services/tts';
import { recognizeWithSherpa, isSherpaModelReady } from '../services/sherpa_asr';
import { translateText, getCachedTranslation, putCachedTranslation, getTranslationCacheData, clearTranslationCache } from '../services/translate';
import { classifyText, normalizeCaseByType } from '../services/nlp';
import {
  successResponse, errorResponse, ensureDirExists,
  getRequestParam, normalizeWordForFilename, ROOT_DIR, APP_ROOT_DIR, CACHE_DIR, ASSETS_DIR, resolveAssetPath,
  findPronunciationFile
} from '../utils/helpers';
import { downloadAsset,
  getAssetsStatus,
  getAllDownloadProgress,
  getDownloadProgress,
  isAssetDownloaded,
  pauseAssetDownload,
} from '../services/asset-manager';
import {
  startBulkDownload,
  pauseBulkDownload,
  cancelBulkDownload,
  getBulkDownloadStatus
} from '../services/pronunciation-downloader';
import { LRUCache } from '../utils/cache';

// ==================== 路径常量 ====================
const STATIC_DIR = path.join(APP_ROOT_DIR, 'dist');
const AUDIO_CACHE_DIR = path.join(CACHE_DIR, 'audio');
const WORDBOOKS_FILE = path.join(ROOT_DIR, 'wordbooks.json');
const TRANSLATION_CACHE_FILE = path.join(CACHE_DIR, 'translation.json');

// ==================== 系统单词本数量缓存 ====================
let systemWordbooksCache: { id: string; name: string; tag: string; count: number }[] | null = null;
let systemWordbooksWarmPromise: Promise<void> | null = null;

function computeSystemWordbooks() {
  const mainDb = getMainDb();
  if (!mainDb) {
    throw new Error('词典未初始化');
  }

  const result = [];
  for (const wb of SYSTEM_WORDBOOKS) {
    result.push({
      id: wb.id,
      name: wb.name,
      tag: wb.tag,
      count: mainDb.countByTag(wb.tag),
    });
  }
  return result;
}

/** 后台预热系统单词本数量缓存，建议在数据库初始化后调用 */
export function warmSystemWordbooksCache(): Promise<void> {
  if (systemWordbooksCache) return Promise.resolve();
  if (systemWordbooksWarmPromise) return systemWordbooksWarmPromise;

  systemWordbooksWarmPromise = new Promise((resolve) => {
    setTimeout(() => {
      try {
        systemWordbooksCache = computeSystemWordbooks();
      } catch (e: any) {
        console.error('预热系统单词本缓存失败:', e.message || e);
      }
      resolve();
    }, 0);
  });
  return systemWordbooksWarmPromise;
}

// ==================== 翻译缓存（共享 translate.ts 的缓存，统一管理） ====================

// 启动时从文件加载到共享缓存
(function loadTranslationCache() {
  try {
    if (fs.existsSync(TRANSLATION_CACHE_FILE)) {
      const data = JSON.parse(fs.readFileSync(TRANSLATION_CACHE_FILE, 'utf-8'));
      const entries = Object.entries(data) as [string, string][];
      const recent = entries.slice(-1000);
      for (const [k, v] of recent) {
        putCachedTranslation(k, v);
      }
    }
  } catch (e) { console.error('[API] 加载翻译缓存失败:', e); }
})();

function saveTranslationCache() {
  try {
    ensureDirExists(CACHE_DIR);
    const tmp = TRANSLATION_CACHE_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(getTranslationCacheData(), null, 2), 'utf-8');
    fs.renameSync(tmp, TRANSLATION_CACHE_FILE);
  } catch (e) { console.error('[API] 保存翻译缓存失败:', e); }
}

// ==================== 例句缓存 ====================
const examplesCache = new LRUCache<any[]>(500);

// ==================== 辅助函数 ====================

function validateAccent(accent: string): boolean {
  return accent === 'uk' || accent === 'us';
}

function getLemma(word: string): string {
  const db = getLemmaDB();
  return db.getLemma(word) || word;
}

function isLemmaDuplicate(lemma: string, wordList: string[]): boolean {
  const db = getLemmaDB();
  const lemmaLower = lemma.toLowerCase();
  for (const w of wordList) {
    const existingLemma = db.getLemma(w) || w;
    if (existingLemma.toLowerCase() === lemmaLower) return true;
  }
  return false;
}

function normalizeWord(word: string): string {
  if (!word) return word;
  if (word.includes(' ')) return word;
  return word[0].toLowerCase() + word.slice(1);
}

function extractWordsFromText(text: string): string[] {
  const words: string[] = [];
  const lines = text.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let w = trimmed;
    if (w.includes('|')) {
      w = w.split('|')[0].trim();
    }
    if (w) {
      if (w.includes(' ')) {
        w = w.charAt(0).toLowerCase() + w.slice(1);
      }
      words.push(w);
    }
  }
  return words;
}

function queryDict(word: string): any {
  const mainDb = getMainDb();
  if (!mainDb) return null;

  const result = mainDb.query(word);
  if (!result) return null;

  const merged = { ...result };
  if (!merged.word) merged.word = merged.sw || word;
  merged.from_dicts = ['stardict'];
  merged.input_type = classifyText(word);
  return merged;
}

// ==================== 单词本文件操作 ====================

function loadWordbooks(): Record<string, string[]> {
  try {
    if (fs.existsSync(WORDBOOKS_FILE)) {
      return JSON.parse(fs.readFileSync(WORDBOOKS_FILE, 'utf-8'));
    }
  } catch (e) { console.error('[API] 加载单词本失败:', e); }
  return {};
}

function saveWordbooks(wordbooks: Record<string, string[]>): void {
  try {
    const tmp = WORDBOOKS_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(wordbooks, null, 2), 'utf-8');
    fs.renameSync(tmp, WORDBOOKS_FILE);
  } catch (e) { console.error('[API] 保存单词本失败:', e); }
}

// ==================== 系统单词本配置 ====================

const SYSTEM_WORDBOOKS = [
  { id: 'sys_zk', name: '中考', tag: 'zk' },
  { id: 'sys_gk', name: '高考', tag: 'gk' },
  { id: 'sys_cet4', name: '四级', tag: 'cet4' },
  { id: 'sys_cet6', name: '六级', tag: 'cet6' },
  { id: 'sys_ky', name: '考研', tag: 'ky' },
  { id: 'sys_toefl', name: '托福', tag: 'toefl' },
  { id: 'sys_ielts', name: '雅思', tag: 'ielts' },
  { id: 'sys_gre', name: 'GRE', tag: 'gre' },
];

// tag → 中文名映射
const SYSTEM_TAGS: Record<string, string> = {
  zk: '中考', gk: '高考', cet4: '四级', cet6: '六级',
  ky: '考研', toefl: '托福', ielts: '雅思', gre: 'GRE',
};

// 从词典数据库查询系统单词本
function querySystemWordbook(dbPath: string, tag: string): string[] {
  const Database = require('better-sqlite3');
  const conn = new Database(dbPath, { readonly: true });
  const rows = conn.prepare("SELECT word FROM stardict WHERE tag LIKE ? ORDER BY word COLLATE NOCASE").all(`%${tag}%`) as any[];
  conn.close();
  return rows.map((r: any) => r.word);
}

// 导出前把 translation 字段里的字面量 \n 还原成真实换行，再统一用分号拼接
function normalizeTranslationForExport(text?: string): string {
  if (!text) return '';
  return text
    .replace(/\\r\\n/g, '\n')
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\n')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\n/g, '; ')
    .trim();
}

// 按字母顺序排序（不区分大小写）
function sortWordsAlphabetically(words: string[]): string[] {
  return [...words].sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }));
}

// 把词条按类型分为三组：单词 / 短语 / 句子（短语首字母小写，句子首字母大写）
function splitIntoGroups(entries: { word: string; phonetic?: string; translation?: string }[]): {
  words: typeof entries;
  phrases: typeof entries;
  sentences: typeof entries;
} {
  const words: typeof entries = [];
  const phrases: typeof entries = [];
  const sentences: typeof entries = [];
  for (const e of entries) {
    const type = classifyText(e.word);
    const normalized = normalizeCaseByType(e.word);
    const entry = { ...e, word: normalized };
    if (type === 'word') words.push(entry);
    else if (type === 'phrase') phrases.push(entry);
    else sentences.push(entry);
  }
  return { words, phrases, sentences };
}

// 生成 txt 导出内容：标题 + 单词节 + 短语节 + 句子节
function generateTxtContent(
  wordbookName: string,
  entries: { word: string; phonetic?: string; translation?: string }[],
  exportMeaning: boolean,
  exportPhonetic: boolean
): string {
  const { words, phrases, sentences } = splitIntoGroups(entries);
  const lines: string[] = [
    `${wordbookName} Word List`,
    `Export time: ${new Date().toISOString().slice(0, 19).replace('T', ' ')}`,
    '',
  ];

  const separator = (label: string) => {
    const totalWidth = 60;
    const side = Math.max(2, Math.floor((totalWidth - label.length) / 2));
    return '-'.repeat(side) + label + '-'.repeat(totalWidth - side - label.length);
  };

  lines.push(separator('单词'));
  for (const r of words) {
    let line = r.word;
    if (exportPhonetic && r.phonetic) {
      let clean = r.phonetic;
      if (clean.startsWith('.')) clean = 'ˌ' + clean.slice(1);
      line += ` [${clean}]`;
    }
    lines.push(line);
    if (exportMeaning && r.translation) {
      lines.push(`释义: ${r.translation}`);
    }
  }

  if (phrases.length > 0) {
    lines.push('');
    lines.push(separator('短语'));
    for (const r of phrases) {
      lines.push(r.word);
      if (exportMeaning && r.translation) {
        lines.push(`释义: ${r.translation}`);
      }
    }
  }

  if (sentences.length > 0) {
    lines.push('');
    lines.push(separator('句子'));
    for (const r of sentences) {
      lines.push(r.word);
      if (exportMeaning && r.translation) {
        lines.push(`释义: ${r.translation}`);
      }
    }
  }

  return lines.join('\n');
}

// 查询单词释义，词典查不到则尝试在线翻译并缓存
async function lookupWordForExport(word: string): Promise<{ word: string; phonetic?: string; translation?: string }> {
  let result = queryDict(word);
  if (result && result.translation) {
    return {
      word,
      phonetic: result.phonetic,
      translation: normalizeTranslationForExport(result.translation),
    };
  }

  const cached = getCachedTranslation(word);
  if (cached) {
    return { word, phonetic: result?.phonetic, translation: normalizeTranslationForExport(cached) };
  }

  try {
    const trans = await translateText(word);
    if (trans && trans !== word && trans.trim().length > 0) {
      putCachedTranslation(word, trans);
      saveTranslationCache();
      return { word, phonetic: result?.phonetic, translation: normalizeTranslationForExport(trans) };
    }
  } catch (e: any) {
    console.error(`[API] 导出时翻译 ${word} 失败:`, e.message || e);
  }

  return {
    word,
    phonetic: result?.phonetic,
    translation: normalizeTranslationForExport(result?.translation),
  };
}

// 导出单词本为 docx 格式
async function exportWordbookDocx(
  wordbookName: string,
  wordEntries: { word: string; phonetic?: string; translation?: string }[],
  exportMeaning: boolean,
  exportPhonetic: boolean
): Promise<Buffer> {
  const docx = require('docx');
  const { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType } = docx;
  const children: any[] = [
    new Paragraph({ text: `${wordbookName} Word List`, heading: HeadingLevel.HEADING_1 }),
    new Paragraph({ text: `Export time: ${new Date().toISOString().slice(0, 19).replace('T', ' ')}` }),
    new Paragraph({ text: '' }),
  ];

  const { words, phrases, sentences } = splitIntoGroups(wordEntries);

  const addSection = (label: string, entries: typeof wordEntries, showPhonetic: boolean = true) => {
    children.push(new Paragraph({
      text: `-----------------------------${label}-----------------------------`,
      alignment: AlignmentType.CENTER,
    }));
    for (const r of entries) {
      const wordRuns: any[] = [new TextRun({ text: r.word, bold: true, font: 'Cambria' })];
      if (showPhonetic && exportPhonetic && r.phonetic) {
        let clean = r.phonetic;
        if (clean.startsWith('.')) clean = 'ˌ' + clean.slice(1);
        wordRuns.push(new TextRun({ text: `  [${clean}]`, italics: true }));
      }
      children.push(new Paragraph({ children: wordRuns }));
      if (exportMeaning && r.translation) {
        children.push(new Paragraph({
          children: [
            new TextRun({ text: '释义: ', bold: true, font: 'Cambria' }),
            new TextRun({ text: r.translation, font: 'Cambria' }),
          ],
        }));
      }
    }
  };

  addSection('单词', words);
  if (phrases.length > 0) {
    children.push(new Paragraph({ text: '' }));
    addSection('短语', phrases, false);
  }
  if (sentences.length > 0) {
    children.push(new Paragraph({ text: '' }));
    addSection('句子', sentences, false);
  }

  const doc = new Document({ sections: [{ children }] });
  return Buffer.from(await Packer.toBuffer(doc));
}

// ==================== CORS 中间件 ====================

function corsMiddleware(req: Request, res: Response, next: Function) {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  res.set('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE,OPTIONS');
  if (req.method === 'OPTIONS') {
    res.status(200).send();
    return;
  }
  next();
}

// ==================== 路由注册 ====================

export function setupRoutes(app: any) {
  // 全局 CORS
  app.use(corsMiddleware);

  // JSON body 解析
  const express = require('express');
  app.use(express.json({ limit: '50mb' }));

  // ---- 1. 主页 ----
  app.get('/', (req: Request, res: Response) => {
    res.sendFile(path.join(STATIC_DIR, 'index.html'));
  });

  // ---- 3. 查询单词 ----
  app.get('/api/search', (req: Request, res: Response) => {
    console.log('[API] /api/search 收到请求');
    try {
      const word = (req.query.word as string || '').trim();
      if (!word) {
        res.status(400).json(errorResponse('请提供要查询的单词', 400));
        return;
      }
      if (word.length > 200) {
        res.status(400).json(errorResponse('单词长度不能超过200个字符', 400));
        return;
      }
      const result = queryDict(word);
      console.log('[API] /api/search 查询结果:', word, result ? '已找到' : '未找到');
      if (result) {
        res.json(successResponse(result));
      } else {
        res.status(404).json(errorResponse(`未找到单词: ${word}`, 404));
      }
    } catch (e: any) {
      console.error('[API] /api/search 查询出错:', e);
      res.status(500).json(errorResponse(e.message || '查询失败', 500));
    }
  });

  // ---- 3.5 中文释义搜索 ----
  app.get('/api/search-chinese', (req: Request, res: Response) => {
    console.log('[API] /api/search-chinese 收到请求');
    try {
      const keyword = (req.query.keyword as string || '').trim();
      if (!keyword) {
        res.status(400).json(errorResponse('请提供要搜索的中文关键词', 400));
        return;
      }
      if (keyword.length > 50) {
        res.status(400).json(errorResponse('关键词长度不能超过50个字符', 400));
        return;
      }

      const mainDb = getMainDb();
      if (!mainDb) {
        res.status(500).json(errorResponse('词典未初始化', 500));
        return;
      }

      const results = mainDb.searchByChinese(keyword, 50);
      console.log('[API] /api/search-chinese 搜索结果:', keyword, results.length);
      res.json(successResponse(results));
    } catch (e: any) {
      console.error('[API] /api/search-chinese 查询出错:', e);
      res.status(500).json(errorResponse(e.message || '搜索失败', 500));
    }
  });

  // ---- 4. 模糊匹配 ----
  app.get('/api/match', (req: Request, res: Response) => {
    try {
      const prefix = (req.query.prefix as string || '').trim();
      const limit = Math.min(Math.max(parseInt(req.query.limit as string || '10', 10) || 10, 1), 100);
      const category = (req.query.category as string || '').trim().toLowerCase();

      if (!prefix) {
        res.status(400).json(errorResponse('请提供前缀参数', 400));
        return;
      }
      if (prefix.length > 100) {
        res.status(400).json(errorResponse('前缀长度不能超过100个字符', 400));
        return;
      }

      const mainDb = getMainDb();
      if (!mainDb) {
        res.status(500).json(errorResponse('词典未初始化', 500));
        return;
      }

      const result = mainDb.matchWithSort(prefix, limit, category);
      res.json(successResponse(result));
    } catch (e: any) {
      res.status(500).json(errorResponse(e.message || '匹配失败', 500));
    }
  });

  // ---- 5. 例句查询 ----
  app.get('/api/examples', (req: Request, res: Response) => {
    try {
      const word = (req.query.word as string || '').trim().toLowerCase();
      if (!word) {
        res.status(400).json(errorResponse('请提供要查询的单词', 400));
        return;
      }

      const cached = examplesCache.get(word);
      if (cached !== undefined) {
        res.json(successResponse(cached));
        return;
      }

      const examples = findExamplesForWord(word);
      if (examples && examples.length > 0) {
        examplesCache.put(word, examples);
      }
      res.json(successResponse(examples));
    } catch (e: any) {
      res.status(500).json(errorResponse(e.message || '查询例句失败', 500));
    }
  });

  // ---- 6. 批量查询 ----
  app.post('/api/words/batch', (req: Request, res: Response) => {
    try {
      const words = getRequestParam(req, 'words', []);
      if (!words || !Array.isArray(words) || words.length === 0) {
        res.status(400).json(errorResponse('请提供单词列表'));
        return;
      }

      const wordDataList = [];
      for (const word of words) {
        const wordInfo = queryDict(word);
        const enhancedInfo = getWordEnhancedInfo(word);
        wordDataList.push({
          word,
          info: wordInfo,
          enhanced: enhancedInfo,
        });
      }

      res.json(successResponse(wordDataList));
    } catch (e: any) {
      res.status(500).json(errorResponse(e.message || '批量查询失败', 500));
    }
  });

  // ---- 7. 发音文件 ----
  app.get('/api/audio/:accent/*', async (req: Request, res: Response) => {
    try {
      const accent = req.params.accent;
      if (!validateAccent(accent)) {
        res.status(400).json(errorResponse('口音类型必须是 uk 或 us', 400));
        return;
      }

      // 从 path 中提取 word（去掉 /api/audio/:accent/ 前缀和 .mp3 后缀）
      const basePath = `/api/audio/${accent}/`;
      let word = req.path.substring(req.path.indexOf(basePath) + basePath.length);
      if (word.endsWith('.mp3')) word = word.slice(0, -4);
      word = decodeURIComponent(word);

      const filename = `${normalizeWordForFilename(word)}_${accent}.mp3`;
      const filepath = findPronunciationFile(filename);

      if (filepath) {
        // 如果当前缓存不是有道，先尝试升级成有道（不阻塞播放）
        const providerFile = filepath + '.provider';
        let provider: string | null = null;
        try {
          if (fs.existsSync(providerFile)) {
            provider = fs.readFileSync(providerFile, 'utf8').trim();
          }
        } catch {}
        if (provider && provider !== 'youdao') {
          const tts = getTTS();
          if (tts) {
            try {
              await tts.tryUpgradeToYoudao(word, accent, filepath);
            } catch {}
          }
        }
        res.set('Content-Type', 'audio/mpeg');
        res.sendFile(filepath);
        return;
      }

      // 文件不存在：立即调用 TTS 生成，免一次 404 往返
      const tts = getTTS();
      if (tts) {
        const generatedPath = await tts.getPronunciation(word, accent, false);
        if (generatedPath && fs.existsSync(generatedPath)) {
          res.set('Content-Type', 'audio/mpeg');
          res.sendFile(generatedPath);
          return;
        }
      }

      res.status(404).json(errorResponse(`未找到发音文件: ${filename}`, 404));
    } catch (e: any) {
      res.status(500).json(errorResponse(e.message || '获取发音文件失败', 500));
    }
  });

  // ---- 8. 缓存音频 ----
  app.get('/api/audio/cache/:accent/*', async (req: Request, res: Response) => {
    try {
      const accent = req.params.accent;
      if (!validateAccent(accent)) {
        res.status(400).json(errorResponse('口音类型必须是 uk 或 us', 400));
        return;
      }

      const basePath = `/api/audio/cache/${accent}/`;
      let word = req.path.substring(req.path.indexOf(basePath) + basePath.length);
      if (word.endsWith('.mp3')) word = word.slice(0, -4);
      word = decodeURIComponent(word);

      const filename = `${normalizeWordForFilename(word)}_${accent}.mp3`;

      // 先查缓存目录
      const cachePath = path.join(AUDIO_CACHE_DIR, filename);
      if (fs.existsSync(cachePath)) {
        res.set('Content-Type', 'audio/mpeg');
        res.sendFile(cachePath);
        return;
      }

      // 回退到永久目录（用户目录优先，再回退安装目录）
      const permPath = findPronunciationFile(filename);
      if (permPath) {
        res.set('Content-Type', 'audio/mpeg');
        res.sendFile(permPath);
        return;
      }

      // 都没有：在线生成
      const tts = getTTS();
      if (tts) {
        const generated = await tts.getPronunciation(word, accent, false);
        if (generated && fs.existsSync(generated)) {
          res.set('Content-Type', 'audio/mpeg');
          res.sendFile(generated);
          return;
        }
      }

      res.status(404).json(errorResponse('未找到发音文件', 404));
    } catch (e: any) {
      res.status(500).json(errorResponse(e.message || '获取音频失败', 500));
    }
  });

  // ---- 9. 生成发音 ----
  app.post('/api/audio/generate', async (req: Request, res: Response) => {
    try {
      const text = (getRequestParam(req, 'text', '') as string).trim();
      let accent = (getRequestParam(req, 'accent', 'us') as string).toLowerCase();
      const forceRegenerate = String(getRequestParam(req, 'force_regenerate', 'false')).toLowerCase() === 'true';

      if (!text) {
        res.status(400).json(errorResponse('请提供要生成发音的文本'));
        return;
      }

      if (!validateAccent(accent)) {
        res.status(400).json(errorResponse('口音类型必须是 uk 或 us'));
        return;
      }

      const tts = getTTS();
      if (!tts) {
        res.status(500).json(errorResponse('TTS 未初始化', 500));
        return;
      }

      const filepath = await tts.getPronunciation(text, accent, forceRegenerate);

      if (filepath) {
        const filename = path.basename(filepath);
        const isPermanent = filepath.includes('pronunciations');
        res.json(successResponse({ filename, filepath, accent, is_permanent: isPermanent }));
      } else {
        res.status(500).json(errorResponse('生成发音失败', 500));
      }
    } catch (e: any) {
      res.status(500).json(errorResponse(e.message || '生成发音失败', 500));
    }
  });

  // ---- 10. 离线发音包批量下载 ----
  app.get('/api/pronunciations/download/status', (req: Request, res: Response) => {
    res.json(successResponse(getBulkDownloadStatus()));
  });

  app.post('/api/pronunciations/download/start', async (req: Request, res: Response) => {
    try {
      const accent = String(getRequestParam(req, 'accent', 'us')).toLowerCase();
      if (accent !== 'us' && accent !== 'uk') {
        res.status(400).json(errorResponse('accent 必须是 us 或 uk'));
        return;
      }
      await startBulkDownload(accent as 'us' | 'uk');
      res.json(successResponse(getBulkDownloadStatus()));
    } catch (e: any) {
      res.status(500).json(errorResponse(e.message || '启动下载失败', 500));
    }
  });

  app.post('/api/pronunciations/download/pause', (req: Request, res: Response) => {
    pauseBulkDownload();
    res.json(successResponse(getBulkDownloadStatus()));
  });

  app.post('/api/pronunciations/download/cancel', (req: Request, res: Response) => {
    cancelBulkDownload();
    res.json(successResponse(getBulkDownloadStatus()));
  });

  // ---- 11. 语音识别（Sherpa-ONNX） ----
  app.get('/api/speech/engine', async (req: Request, res: Response) => {
    const sherpaReady = await isSherpaModelReady();
    res.json(successResponse({
      engine: sherpaReady ? 'sherpa' : 'none',
      ready: sherpaReady
    }));
  });

  app.post('/api/speech/recognize', async (req: Request, res: Response) => {
    try {
      const audio = (getRequestParam(req, 'audio', '') as string).trim();
      if (!audio) {
        res.status(400).json(errorResponse('请提供音频数据'));
        return;
      }

      if (!(await isSherpaModelReady())) {
        res.status(503).json(errorResponse('Sherpa-ONNX 模型未就绪'));
        return;
      }

      const result = await recognizeWithSherpa(audio);
      if (result.ok) {
        console.log('[speech] Sherpa 识别成功:', result.text || '(空)');
        res.json(successResponse({ text: result.text || '', engine: 'sherpa' }));
      } else {
        console.log('[speech] Sherpa 识别失败:', result.error);
        res.status(500).json(errorResponse(result.error || '语音识别失败'));
      }
    } catch (e: any) {
      console.error('[speech] 语音识别出错:', e);
      res.status(500).json(errorResponse(e.message || '语音识别失败'));
    }
  });

  // ---- 11. 翻译 ----
  app.post('/api/translate', async (req: Request, res: Response) => {
    console.log('[API] /api/translate POST 收到翻译请求');
    try {
      const text = (getRequestParam(req, 'text', '') as string).trim();
      const secretId = (getRequestParam(req, 'secretId', '') as string).trim() || undefined;
      const secretKey = (getRequestParam(req, 'secretKey', '') as string).trim() || undefined;
      console.log('[API] /api/translate 待翻译文本长度:', text.length);
      if (!text) {
        res.status(400).json(errorResponse('请提供要翻译的文本'));
        return;
      }

      // 按类型规范化首字母后再查（短语小写、句子大写，提升命中率和缓存复用率）
      const lookupText = normalizeCaseByType(text);
      const inputType = classifyText(lookupText);

      // 先查翻译缓存（用小写版本查）
      const cached = getCachedTranslation(lookupText);
      if (cached) {
        res.json({
          success: true,
          translation: cached,
          cached: true,
          input_type: inputType,
        });
        return;
      }

      // 先查词典
      const dictResult = queryDict(lookupText);
      if (dictResult && dictResult.translation) {
        res.json({
          success: true,
          data: dictResult,
          translation: dictResult.translation,
          is_from_dict: true,
          input_type: dictResult.input_type || inputType,
        });
        return;
      }

      // 词典没有，走翻译 API（透传用户自定义密钥）
      const translation = await translateText(lookupText, secretId, secretKey);

      if (!translation) {
        // 所有在线翻译都失败，用词典逐词翻译作为兜底
        const words = lookupText.split(/\s+/).filter((w: string) => w.length > 0);
        if (words.length > 1) {
          const wordTrans: string[] = [];
          for (const w of words) {
            const dr = queryDict(w);
            if (dr && dr.translation) {
              // 只取第一条释义
              const firstLine = dr.translation.split('\n')[0].trim();
              wordTrans.push(`${w}(${firstLine})`);
            } else {
              wordTrans.push(w);
            }
          }
          const dictTranslation = wordTrans.join(' ');
          putCachedTranslation(lookupText, dictTranslation);
          saveTranslationCache();
          res.json({
            success: true,
            translation: dictTranslation,
            cached: false,
            is_dict_fallback: true,
            input_type: inputType,
          });
          return;
        }

        res.status(404).json(errorResponse('翻译服务暂不可用，所有翻译接口均失败', 404));
        return;
      }

      putCachedTranslation(lookupText, translation);
      saveTranslationCache();

      res.json({
        success: true,
        translation,
        cached: false,
        input_type: inputType,
      });
    } catch (e: any) {
      res.status(500).json(errorResponse(e.message || '翻译失败', 500));
    }
  });

  // ---- 11. 增强信息 ----
  app.get('/api/enhanced', (req: Request, res: Response) => {
    console.log('[API] /api/enhanced 收到增强信息请求:', req.query.word);
    try {
      const word = (req.query.word as string || '').trim();
      if (!word) {
        res.status(400).json(errorResponse('请提供要查询的单词', 400));
        return;
      }
      const enhancedInfo = getWordEnhancedInfo(word);
      res.json(successResponse(enhancedInfo));
    } catch (e: any) {
      console.error('[API] /api/enhanced 查询增强信息出错:', e);
      res.status(500).json(errorResponse(e.message || '查询增强信息失败', 500));
    }
  });

  // ---- 12. 网络测试 ----
  app.get('/api/network/test', (req: Request, res: Response) => {
    try {
      const tts = getTTS();
      const online = tts ? tts.testNetwork() : false;
      res.json(successResponse({ online }));
    } catch (e: any) {
      res.status(500).json(errorResponse(e.message || '网络测试失败', 500));
    }
  });

  // ---- 13. 单词本列表 ----
  app.get('/api/wordbook/list', (req: Request, res: Response) => {
    try {
      const wordbooks = loadWordbooks();
      res.json(successResponse({ wordbooks }));
    } catch (e: any) {
      res.status(500).json(errorResponse(e.message || '获取单词本列表失败', 500));
    }
  });

  // ---- 14. 创建单词本 ----
  app.post('/api/wordbook/create', (req: Request, res: Response) => {
    try {
      const name = (getRequestParam(req, 'name', '') as string).trim();
      if (!name) {
        res.status(400).json(errorResponse('请提供单词本名称'));
        return;
      }

      const RESERVED = new Set(['wordlist', 'favorites', 'errorbook']);
      if (RESERVED.has(name) || name.startsWith('sys_')) {
        res.status(400).json(errorResponse('该名称为保留名称，请使用其他名称'));
        return;
      }

      const wordbooks = loadWordbooks();
      if (name in wordbooks) {
        res.status(400).json(errorResponse('单词本已存在'));
        return;
      }

      wordbooks[name] = [];
      saveWordbooks(wordbooks);
      res.json(successResponse({ name, wordbooks }));
    } catch (e: any) {
      res.status(500).json(errorResponse(e.message || '创建单词本失败', 500));
    }
  });

  // ---- 15. 删除单词本 ----
  app.post('/api/wordbook/delete', (req: Request, res: Response) => {
    try {
      const name = (getRequestParam(req, 'name', '') as string).trim();
      if (!name) {
        res.status(400).json(errorResponse('请提供单词本名称'));
        return;
      }

      const wordbooks = loadWordbooks();
      if (!(name in wordbooks)) {
        res.status(404).json(errorResponse('单词本不存在', 404));
        return;
      }

      if (['wordlist', 'favorites', 'errorbook'].includes(name)) {
        res.status(400).json(errorResponse('不能删除默认单词本'));
        return;
      }

      delete wordbooks[name];
      saveWordbooks(wordbooks);
      res.json(successResponse({ wordbooks }));
    } catch (e: any) {
      res.status(500).json(errorResponse(e.message || '删除单词本失败', 500));
    }
  });

  // ---- 16. 添加单词到单词本 ----
  app.post('/api/wordbook/add', (req: Request, res: Response) => {
    try {
      const wordbookName = (getRequestParam(req, 'wordbook', '') as string).trim();
      const word = (getRequestParam(req, 'word', '') as string).trim();

      if (!wordbookName || !word) {
        res.status(400).json(errorResponse('缺少必要参数'));
        return;
      }

      const wordbooks = loadWordbooks();
      if (!(wordbookName in wordbooks)) {
        wordbooks[wordbookName] = [];
      }

      const lemma = getLemma(word);
      if (!isLemmaDuplicate(lemma, wordbooks[wordbookName])) {
        const wordToAdd = normalizeWord(word);
        wordbooks[wordbookName].push(wordToAdd);
        saveWordbooks(wordbooks);
      }

      res.json(successResponse({ wordbooks }));
    } catch (e: any) {
      res.status(500).json(errorResponse(e.message || '添加单词失败', 500));
    }
  });

  // ---- 17. 从单词本移除单词 ----
  app.post('/api/wordbook/remove', (req: Request, res: Response) => {
    try {
      const wordbookName = (getRequestParam(req, 'wordbook', '') as string).trim();
      const word = (getRequestParam(req, 'word', '') as string).trim();

      if (!wordbookName || !word) {
        res.status(400).json(errorResponse('缺少必要参数'));
        return;
      }

      const wordbooks = loadWordbooks();
      if (!(wordbookName in wordbooks)) {
        res.status(404).json(errorResponse('单词本不存在', 404));
        return;
      }

      const wordLower = word.toLowerCase();
      wordbooks[wordbookName] = wordbooks[wordbookName].filter(
        (w: string) => w.toLowerCase() !== wordLower
      );
      saveWordbooks(wordbooks);

      res.json(successResponse({ wordbooks }));
    } catch (e: any) {
      res.status(500).json(errorResponse(e.message || '移除单词失败', 500));
    }
  });

  // ---- 18. 重命名单词本 ----
  app.post('/api/wordbook/rename', (req: Request, res: Response) => {
    try {
      const oldName = (getRequestParam(req, 'oldName', '') as string).trim();
      const newName = (getRequestParam(req, 'newName', '') as string).trim();

      if (!oldName || !newName) {
        res.status(400).json(errorResponse('请提供旧名称和新名称'));
        return;
      }

      if (oldName === newName) {
        res.status(400).json(errorResponse('新名称与旧名称相同'));
        return;
      }

      const wordbooks = loadWordbooks();
      if (!(oldName in wordbooks)) {
        res.status(404).json(errorResponse('单词本不存在', 404));
        return;
      }

      if (newName in wordbooks) {
        res.status(400).json(errorResponse('新名称已存在'));
        return;
      }

      wordbooks[newName] = wordbooks[oldName];
      delete wordbooks[oldName];
      saveWordbooks(wordbooks);

      res.json(successResponse({ wordbooks, oldName, newName }));
    } catch (e: any) {
      res.status(500).json(errorResponse(e.message || '重命名单词本失败', 500));
    }
  });

  // ---- 19. 重排序单词本 ----
  app.post('/api/wordbook/reorder', (req: Request, res: Response) => {
    try {
      const name = (getRequestParam(req, 'name', '') as string).trim();
      const orderData = (req.body && req.body.order) ? req.body.order : [];

      if (!name) {
        res.status(400).json(errorResponse('请提供单词本名称'));
        return;
      }

      const wordbooks = loadWordbooks();
      if (!(name in wordbooks)) {
        res.status(404).json(errorResponse('单词本不存在', 404));
        return;
      }

      wordbooks[name] = orderData;
      saveWordbooks(wordbooks);

      res.json(successResponse({ wordbooks }));
    } catch (e: any) {
      res.status(500).json(errorResponse(e.message || '重排序失败', 500));
    }
  });

  // ---- 20. 导出单词本 ----
  app.post('/api/wordbook/export', async (req: Request, res: Response) => {
    try {
      const wordbookName = (getRequestParam(req, 'name', '') as string).trim();
      const exportFormat = (getRequestParam(req, 'format', 'txt') as string).toLowerCase();
      const exportMeaning = getRequestParam(req, 'export_meaning', true);
      const exportPhonetic = getRequestParam(req, 'export_phonetic', true);

      if (!wordbookName) {
        res.status(400).json(errorResponse('请提供单词本名称'));
        return;
      }

      let words: string[] = [];

      if (wordbookName.startsWith('sys_')) {
        const tag = wordbookName.replace('sys_', '');
        if (!(tag in SYSTEM_TAGS)) {
          res.status(404).json(errorResponse('系统单词本不存在', 404));
          return;
        }
        const dbPath = resolveAssetPath('stardict.db');
        words = querySystemWordbook(dbPath, tag);
      } else {
        const wordbooks = loadWordbooks();
        if (!(wordbookName in wordbooks)) {
          res.status(404).json(errorResponse('单词本不存在', 404));
          return;
        }
        words = wordbooks[wordbookName];
      }

      words = sortWordsAlphabetically(words);

      const wordEntries: { word: string; phonetic?: string; translation?: string }[] = [];
      for (const w of words) {
        wordEntries.push(await lookupWordForExport(w));
      }

      if (exportFormat === 'txt') {
        const content = generateTxtContent(wordbookName, wordEntries, exportMeaning, exportPhonetic);
        res.set('Content-Type', 'text/plain;charset=utf-8');
        res.set('Content-Disposition', 'attachment; filename="wordlist.txt"');
        res.send(content);
        return;
      }

      if (exportFormat === 'docx') {
        try {
          const buffer = await exportWordbookDocx(wordbookName, wordEntries, exportMeaning, exportPhonetic);
          res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
          res.set('Content-Disposition', 'attachment; filename="wordlist.docx"');
          res.send(buffer);
          return;
        } catch (docxErr: any) {
          res.status(400).json(errorResponse('需要安装 docx 库才能导出 .docx 文件', 400));
          return;
        }
      }

      res.status(400).json(errorResponse(`不支持的导出格式: ${exportFormat}`, 400));
    } catch (e: any) {
      res.status(500).json(errorResponse(e.message || '导出失败', 500));
    }
  });

  // ---- 20b. 流式导出（SSE 真实进度） ----
  app.post('/api/wordbook/export-stream', async (req: Request, res: Response) => {
    try {
      const wordbookName = (getRequestParam(req, 'name', '') as string).trim();
      const exportFormat = (getRequestParam(req, 'format', 'txt') as string).toLowerCase();
      const exportMeaning = getRequestParam(req, 'export_meaning', true);
      const exportPhonetic = getRequestParam(req, 'export_phonetic', true);

      if (!wordbookName) {
        res.status(400).json(errorResponse('请提供单词本名称'));
        return;
      }

      let words: string[] = [];

      if (wordbookName.startsWith('sys_')) {
        const tag = wordbookName.replace('sys_', '');
        if (!(tag in SYSTEM_TAGS)) {
          res.status(404).json(errorResponse('系统单词本不存在', 404));
          return;
        }
        const dbPath = resolveAssetPath('stardict.db');
        words = querySystemWordbook(dbPath, tag);
      } else {
        const wordbooks = loadWordbooks();
        if (!(wordbookName in wordbooks)) {
          res.status(404).json(errorResponse('单词本不存在', 404));
          return;
        }
        words = wordbooks[wordbookName];
      }

      if (words.length === 0) {
        res.status(400).json(errorResponse('单词本为空'));
        return;
      }

      words = sortWordsAlphabetically(words);

      // SSE 流式响应
      const raw = res as any;
      raw.setHeader('Content-Type', 'text/event-stream');
      raw.setHeader('Cache-Control', 'no-cache');
      raw.setHeader('Connection', 'keep-alive');
      raw.setHeader('X-Accel-Buffering', 'no');

      const sendEvent = (data: unknown) => {
        raw.write(`data: ${JSON.stringify(data)}\n\n`);
      };

      sendEvent({ type: 'start', total: words.length });

      const BATCH = 50;
      const results: { word: string; phonetic?: string; translation?: string }[] = [];

      for (let i = 0; i < words.length; i += BATCH) {
        const batch = words.slice(i, i + BATCH);
        const batchResults = await Promise.all(batch.map(w => lookupWordForExport(w)));
        results.push(...batchResults);
        const processed = Math.min(i + BATCH, words.length);
        sendEvent({ type: 'progress', done: processed, total: words.length });
        // 让出事件循环，避免阻塞
        await new Promise(r => setTimeout(r, 0));
      }

      // 生成文件内容
      let content: Buffer | string;
      let mimeType: string;

      if (exportFormat === 'txt') {
        content = generateTxtContent(wordbookName, results, exportMeaning, exportPhonetic);
        mimeType = 'text/plain;charset=utf-8';
      } else if (exportFormat === 'docx') {
        content = await exportWordbookDocx(wordbookName, results, exportMeaning, exportPhonetic);
        mimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
      } else {
        sendEvent({ type: 'error', message: `不支持的格式: ${exportFormat}` });
        raw.end();
        return;
      }

      // 发送文件数据（base64）
      const contentBuf = typeof content === 'string' ? Buffer.from(content, 'utf-8') : content;
      const base64 = contentBuf.toString('base64');
      sendEvent({
        type: 'done',
        file: base64,
        mimeType,
        filename: `${wordbookName}_单词本.${exportFormat}`,
        total: words.length,
      });

      raw.end();
    } catch (e: any) {
      const rawErr = res as any;
      try { rawErr.write(`data: ${JSON.stringify({ type: 'error', message: e.message })}\n\n`); } catch {}
      try { rawErr.end(); } catch {}
    }
  });

  // ---- 21. 简化 docx 导出 ----
  app.post('/api/wordbook/export-docx', async (req: Request, res: Response) => {
    try {
      const wordbookName = (getRequestParam(req, 'name', '') as string).trim();
      const content = (getRequestParam(req, 'content', '') as string);
      const exportMeaning = getRequestParam(req, 'export_meaning', true);
      const exportPhonetic = getRequestParam(req, 'export_phonetic', true);

      if (!wordbookName) {
        res.status(400).json(errorResponse('请提供单词本名称'));
        return;
      }

      try {
        let words: string[] = [];

        if (content) {
          const rawLines = content.split(/\r?\n/);
          for (const line of rawLines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            const pipeIdx = trimmed.indexOf('|');
            const firstPart = pipeIdx >= 0 ? trimmed.slice(0, pipeIdx).trim() : trimmed;
            if (firstPart) words.push(firstPart);
          }
        } else {
          if (wordbookName.startsWith('sys_')) {
            const tag = wordbookName.replace('sys_', '');
            if (!(tag in SYSTEM_TAGS)) {
              res.status(404).json(errorResponse('系统单词本不存在', 404));
              return;
            }
            const dbPath = resolveAssetPath('stardict.db');
            words = querySystemWordbook(dbPath, tag);
          } else {
            const wordbooks = loadWordbooks();
            if (!(wordbookName in wordbooks)) {
              res.status(404).json(errorResponse('单词本不存在', 404));
              return;
            }
            words = wordbooks[wordbookName];
          }
        }

        words = sortWordsAlphabetically(words);
        const wordEntries: { word: string; phonetic?: string; translation?: string }[] = [];
        for (const w of words) {
          wordEntries.push(await lookupWordForExport(w));
        }
        const buffer = await exportWordbookDocx(wordbookName, wordEntries, exportMeaning, exportPhonetic);
        res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
        res.set('Content-Disposition', `attachment; filename="${encodeURIComponent(wordbookName)}_单词本.docx"`);
        res.send(buffer);
        return;
      } catch (docxErr: any) {
        res.status(400).json(errorResponse('需要安装 docx 库才能导出 .docx 文件', 400));
      }
    } catch (e: any) {
      res.status(500).json(errorResponse(e.message || '导出失败', 500));
    }
  });

  // ---- 22. 导入单词本 ----
  const multer = require('multer');
  const upload = multer({ storage: multer.memoryStorage() });

  app.post('/api/wordbook/import', upload.single('file'), (req: Request, res: Response) => {
    try {
      const wordbookName = (req.body && req.body.name) ? req.body.name.trim() : '';
      if (!wordbookName) {
        res.status(400).json(errorResponse('请提供单词本名称'));
        return;
      }
      const rawWords = (req.body && req.body.words) ? req.body.words : '';

      let wordList: string[] = [];

      // 检查是否有文件上传
      const file = (req as any).file;
      if (file && file.buffer && file.size > 0) {
        const filename = file.originalname || '';
        const ext = path.extname(filename).toLowerCase();
        const fileBuffer = file.buffer;

        if (ext === '.docx') {
          try {
            const mammoth = require('mammoth');
            mammoth.extractRawText({ buffer: fileBuffer }).then((result: any) => {
              wordList = extractWordsFromText(result.value);
              processImport(req, res, wordbookName, wordList);
            }).catch((err: any) => {
              res.status(400).json(errorResponse(`解析 .docx 文件失败: ${err.message}`));
            });
            return;
          } catch {
            res.status(400).json(errorResponse('需要安装 mammoth 库才能导入 .docx 文件'));
            return;
          }
        } else if (ext === '.txt') {
          let text: string;
          try {
            text = fileBuffer.toString('utf-8');
          } catch {
            try {
              text = fileBuffer.toString('gbk');
            } catch {
              text = fileBuffer.toString('latin1');
            }
          }
          wordList = extractWordsFromText(text);
        } else {
          res.status(400).json(errorResponse(`不支持的文件格式: ${ext}。仅支持 .txt 和 .docx 文件。`));
          return;
        }
      } else if (rawWords) {
        wordList = rawWords.split('\n').map((w: string) => w.trim()).filter((w: string) => w.length > 0);
      } else {
        res.status(400).json(errorResponse('请上传文件或提供单词列表'));
        return;
      }

      processImport(req, res, wordbookName, wordList);
    } catch (e: any) {
      res.status(500).json(errorResponse(e.message || '导入失败', 500));
    }
  });

  // ---- 22b. 流式导入（实时进度 + 预查句/词组发音翻译） ----
  app.post('/api/wordbook/import-stream', upload.single('file'), async (req: Request, res: Response) => {
    const raw = res as any;
    const sendEvent = (data: unknown) => {
      try { raw.write(`data: ${JSON.stringify(data)}\n\n`); } catch (e) { console.error('[API] SSE写入失败:', e); }
    };

    try {
      const wordbookName = (req.body && req.body.name) ? req.body.name.trim() : '';
      if (!wordbookName) {
        res.status(400).json(errorResponse('请提供单词本名称'));
        return;
      }

      const RESERVED = new Set(['wordlist', 'favorites', 'errorbook']);
      if (wordbookName.startsWith('sys_') || RESERVED.has(wordbookName)) {
        res.status(400).json(errorResponse('该单词本不可导入，请选择其他单词本'));
        return;
      }

      let wordList: string[] = [];
      const file = (req as any).file;
      if (file && file.buffer && file.size > 0) {
        const filename = file.originalname || '';
        const ext = path.extname(filename).toLowerCase();
        const fileBuffer = file.buffer;

        if (ext === '.docx') {
          try {
            const mammoth = require('mammoth');
            const result = await mammoth.extractRawText({ buffer: fileBuffer });
            wordList = extractWordsFromText(result.value);
          } catch {
            res.status(400).json(errorResponse('需要安装 mammoth 库才能导入 .docx 文件'));
            return;
          }
        } else if (ext === '.txt') {
          let text: string;
          try {
            text = fileBuffer.toString('utf-8');
          } catch {
            try {
              text = fileBuffer.toString('gbk');
            } catch {
              text = fileBuffer.toString('latin1');
            }
          }
          wordList = extractWordsFromText(text);
        } else {
          res.status(400).json(errorResponse(`不支持的文件格式: ${ext}。仅支持 .txt 和 .docx 文件。`));
          return;
        }
      } else if (req.body && req.body.words) {
        wordList = String(req.body.words).split('\n').map((w: string) => w.trim()).filter((w: string) => w.length > 0);
      } else {
        res.status(400).json(errorResponse('请上传文件或提供单词列表'));
        return;
      }

      if (!wordList || wordList.length === 0) {
        res.status(400).json(errorResponse('未找到任何单词，请检查文件内容'));
        return;
      }

      // SSE 头
      raw.setHeader('Content-Type', 'text/event-stream');
      raw.setHeader('Cache-Control', 'no-cache');
      raw.setHeader('Connection', 'keep-alive');
      raw.setHeader('X-Accel-Buffering', 'no');

      const tts = getTTS();

      // 去重、过滤词形（复用原逻辑）
      const wordbooks = loadWordbooks();
      if (!(wordbookName in wordbooks)) {
        wordbooks[wordbookName] = [];
      }

      const existingLemmas = new Set<string>();
      for (const w of wordbooks[wordbookName]) {
        const lemma = getLemma(w);
        existingLemmas.add(lemma.toLowerCase());
      }

      const seenLemmas = new Set<string>();
      const uniqueWordList: string[] = [];
      for (const word of wordList) {
        if (word.includes(' ')) {
          uniqueWordList.push(normalizeCaseByType(word));
        } else {
          const normalized = normalizeWord(word);
          const lemma = getLemma(word);
          const lemmaLower = lemma.toLowerCase();
          if (!seenLemmas.has(lemmaLower)) {
            seenLemmas.add(lemmaLower);
            uniqueWordList.push(normalized);
          }
        }
      }

      sendEvent({ type: 'start', total: uniqueWordList.length, raw_total: wordList.length });

      let wordCount = 0;
      let phraseCount = 0;
      const successWords: string[] = [];
      const failedWords: string[] = [];
      const duplicatedWords: string[] = [];
      const prefetchResults: { word: string; pronunciation?: boolean; translation?: boolean }[] = [];

      for (let i = 0; i < uniqueWordList.length; i++) {
        const word = uniqueWordList[i];
        const isPhrase = word.includes(' ');
        if (isPhrase) phraseCount++; else wordCount++;

        sendEvent({ type: 'stage', index: i + 1, total: uniqueWordList.length, word, message: `正在解析 ${word}` });

        // 加入单词本
        try {
          if (isPhrase) {
            const wordLower = word.toLowerCase();
            const exists = wordbooks[wordbookName].some((w: string) => w.toLowerCase() === wordLower);
            if (!exists) {
              wordbooks[wordbookName].push(word);
              successWords.push(word);
            } else {
              duplicatedWords.push(word);
            }
          } else {
            const lemma = getLemma(word);
            if (!existingLemmas.has(lemma.toLowerCase())) {
              wordbooks[wordbookName].push(word);
              successWords.push(word);
              existingLemmas.add(lemma.toLowerCase());
            } else {
              duplicatedWords.push(word);
            }
          }
        } catch {
          failedWords.push(word);
          sendEvent({ type: 'stage', index: i + 1, total: uniqueWordList.length, word, message: `加入单词本失败 ${word}` });
          continue;
        }

        // 句/词组预查发音和翻译
        if (isPhrase) {
          const prefetch: { word: string; pronunciation?: boolean; translation?: boolean } = { word };

          if (tts) {
            sendEvent({ type: 'stage', index: i + 1, total: uniqueWordList.length, word, message: `正在查询 ${word} 的发音` });
            try {
              const pronPath = await tts.getPronunciation(word, 'us', false);
              prefetch.pronunciation = !!pronPath;
              sendEvent({ type: 'stage', index: i + 1, total: uniqueWordList.length, word, message: `发音查询成功 ${word}` });
            } catch {
              prefetch.pronunciation = false;
              sendEvent({ type: 'stage', index: i + 1, total: uniqueWordList.length, word, message: `发音查询失败 ${word}` });
            }
          }

          sendEvent({ type: 'stage', index: i + 1, total: uniqueWordList.length, word, message: `正在查询 ${word} 的翻译` });
          try {
            const dictResult = queryDict(word);
            let translated = false;
            if (dictResult && dictResult.translation) {
              translated = true;
            } else {
              const trans = await translateText(word);
              translated = !!trans && trans !== word;
            }
            prefetch.translation = translated;
            sendEvent({ type: 'stage', index: i + 1, total: uniqueWordList.length, word, message: `翻译查询成功 ${word}` });
          } catch {
            prefetch.translation = false;
            sendEvent({ type: 'stage', index: i + 1, total: uniqueWordList.length, word, message: `翻译查询失败 ${word}` });
          }

          prefetchResults.push(prefetch);
        }

        sendEvent({ type: 'progress', done: i + 1, total: uniqueWordList.length });
        // 让出事件循环，保证进度能发出去
        await new Promise(r => setTimeout(r, 0));
      }

      saveWordbooks(wordbooks);

      sendEvent({
        type: 'complete',
        data: {
          total: wordList.length,
          word_count: wordCount,
          phrase_count: phraseCount,
          success_count: successWords.length,
          failed_count: failedWords.length,
          duplicated_count: duplicatedWords.length,
          success_words: successWords,
          failed_words: failedWords,
          duplicated_words: duplicatedWords,
          prefetch_results: prefetchResults,
        }
      });
      raw.end();
    } catch (e: any) {
      try {
        sendEvent({ type: 'error', message: e.message || '导入失败' });
        raw.end();
      } catch {
        res.status(500).json(errorResponse(e.message || '导入失败', 500));
      }
    }
  });

  // ---- 23. 系统单词本 ----
  app.get('/api/system-wordbooks', (req: Request, res: Response) => {
    try {
      if (systemWordbooksCache) {
        res.json(successResponse(systemWordbooksCache));
        return;
      }

      // 如果后台正在预热，等它完成（避免重复执行慢查询）
      if (systemWordbooksWarmPromise) {
        systemWordbooksWarmPromise.then(() => {
          if (systemWordbooksCache) {
            res.json(successResponse(systemWordbooksCache));
          } else {
            res.status(500).json(errorResponse('获取系统单词本失败', 500));
          }
        });
        return;
      }

      const result = computeSystemWordbooks();
      systemWordbooksCache = result;
      res.json(successResponse(result));
    } catch (e: any) {
      res.status(500).json(errorResponse(e.message || '获取系统单词本失败', 500));
    }
  });

  // ---- 24. 系统单词本单词列表（分页） ----
  app.get('/api/system-wordbook/words', (req: Request, res: Response) => {
    try {
      const tag = (req.query.tag as string || '').trim();
      if (!tag) {
        res.status(400).json(errorResponse('请提供标签参数', 400));
        return;
      }
      if (tag.length > 20) {
        res.status(400).json(errorResponse('标签参数无效', 400));
        return;
      }

      const limit = Math.min(Math.max(parseInt(req.query.limit as string || '100', 10) || 100, 1), 10000);
      const offset = Math.max(parseInt(req.query.offset as string || '0', 10) || 0, 0);

      const Database = require('better-sqlite3');
      const dbPath = resolveAssetPath('stardict.db');
      const conn = new Database(dbPath, { readonly: true });

      const countRow = conn.prepare('SELECT COUNT(*) as cnt FROM stardict WHERE tag LIKE ?').get(`%${tag}%`) as any;
      const total = countRow.cnt;

      const rows = conn.prepare(
        'SELECT word, phonetic, translation, tag FROM stardict WHERE tag LIKE ? ORDER BY word COLLATE NOCASE LIMIT ? OFFSET ?'
      ).all(`%${tag}%`, limit, offset) as any[];

      const words = rows.map((r: any) => ({
        word: r.word,
        phonetic: r.phonetic || '',
        translation: r.translation || '',
        tag: r.tag || '',
      }));

      conn.close();

      res.json(successResponse({
        words,
        total,
        limit,
        offset,
        hasMore: offset + limit < total,
      }));
    } catch (e: any) {
      res.status(500).json(errorResponse(e.message || '获取单词列表失败', 500));
    }
  });

  // ---- 25. 系统单词本搜索 ----
  app.get('/api/system-wordbook/search', (req: Request, res: Response) => {
    try {
      const tag = (req.query.tag as string || '').trim();
      const keyword = (req.query.keyword as string || '').trim();
      const limit = Math.min(Math.max(parseInt(req.query.limit as string || '10000', 10) || 10000, 1), 10000);

      if (!tag) {
        res.status(400).json(errorResponse('请提供标签参数', 400));
        return;
      }
      if (tag.length > 20) {
        res.status(400).json(errorResponse('标签参数无效', 400));
        return;
      }

      const Database = require('better-sqlite3');
      const dbPath = resolveAssetPath('stardict.db');
      const conn = new Database(dbPath, { readonly: true });

      let words: any[] = [];

      if (keyword) {
        const rows = conn.prepare(
          'SELECT word, phonetic, translation, tag FROM stardict WHERE tag LIKE ? AND LOWER(word) LIKE ?'
        ).all(`%${tag}%`, `%${keyword.toLowerCase()}%`) as any[];

        const allMatches = rows.map((r: any) => ({
          word: r.word,
          phonetic: r.phonetic || '',
          translation: r.translation || '',
          tag: r.tag || '',
        }));

        const startsWith: any[] = [];
        const contains: any[] = [];
        for (const w of allMatches) {
          if (w.word.toLowerCase().startsWith(keyword.toLowerCase())) {
            startsWith.push(w);
          } else {
            contains.push(w);
          }
        }
        startsWith.sort((a: any, b: any) => a.word.toLowerCase().localeCompare(b.word.toLowerCase()));
        contains.sort((a: any, b: any) => a.word.toLowerCase().localeCompare(b.word.toLowerCase()));

        words = [...startsWith, ...contains].slice(0, limit);
      } else {
        const rows = conn.prepare(
          'SELECT word, phonetic, translation, tag FROM stardict WHERE tag LIKE ? ORDER BY word COLLATE NOCASE LIMIT ?'
        ).all(`%${tag}%`, limit) as any[];
        words = rows.map((r: any) => ({
          word: r.word,
          phonetic: r.phonetic || '',
          translation: r.translation || '',
          tag: r.tag || '',
        }));
      }

      conn.close();

      res.json(successResponse({
        words,
        count: words.length,
      }));
    } catch (e: any) {
      res.status(500).json(errorResponse(e.message || '搜索失败', 500));
    }
  });

  // ---- 26. 清除缓存 ----
  app.post('/api/cache/clear', (req: Request, res: Response) => {
    const clearedItems: string[] = [];
    const errors: string[] = [];

    // 翻译缓存
    try {
      clearTranslationCache();
      if (fs.existsSync(TRANSLATION_CACHE_FILE)) {
        fs.unlinkSync(TRANSLATION_CACHE_FILE);
        clearedItems.push('翻译缓存文件');
      }
      saveTranslationCache();
    } catch (e: any) {
      errors.push('翻译缓存: ' + (e.message || '未知错误'));
    }

    // 音频缓存目录
    try {
      if (fs.existsSync(AUDIO_CACHE_DIR)) {
        fs.rmSync(AUDIO_CACHE_DIR, { recursive: true, force: true });
        ensureDirExists(AUDIO_CACHE_DIR);
        clearedItems.push('音频缓存目录');
      }
    } catch (e: any) {
      errors.push('音频缓存: ' + (e.message || '未知错误'));
    }

    if (errors.length > 0 && clearedItems.length === 0) {
      res.status(500).json(errorResponse(errors.join('; '), 500));
      return;
    }

    res.json(successResponse({
      message: `缓存清除完成。已清除: ${clearedItems.join(', ') || '无'}`,
      cleared_items: clearedItems,
      errors: errors.length > 0 ? errors : undefined,
    }));
  });

  // ---- 27. 可下载资源状态 ----
  app.get('/api/assets/status', (req: Request, res: Response) => {
    try {
      res.json(successResponse(getAssetsStatus()));
    } catch (e: any) {
      res.status(500).json(errorResponse(e.message || '获取资源状态失败', 500));
    }
  });

  // ---- 28. 可下载资源进度 ----
  app.get('/api/assets/progress', (req: Request, res: Response) => {
    try {
      const assetId = (req.query.assetId as string || '').trim();
      if (assetId) {
        res.json(successResponse(getDownloadProgress(assetId)));
      } else {
        res.json(successResponse(Object.fromEntries(getAllDownloadProgress())));
      }
    } catch (e: any) {
      res.status(500).json(errorResponse(e.message || '获取下载进度失败', 500));
    }
  });

  // ---- 29. 触发下载可选资源 ----
  app.post('/api/assets/download', async (req: Request, res: Response) => {
    try {
      const assetId = (getRequestParam(req, 'assetId', '') as string).trim();
      if (!assetId) {
        res.status(400).json(errorResponse('请提供 assetId'));
        return;
      }
      if (isAssetDownloaded(assetId)) {
        res.json(successResponse({ message: '资源已存在', assetId, downloaded: true }));
        return;
      }
      // 启动后台下载并立即返回，前端通过 /api/assets/progress 轮询进度
      downloadAsset(assetId).catch(e => {
        // 用户主动暂停不算错误
        if (e?.message?.includes('aborted') || e?.name === 'AbortError') {
          console.log(`[assets] 资源 ${assetId} 下载被用户暂停`);
          return;
        }
        console.error(`[assets] 后台下载 ${assetId} 失败:`, e.message || e);
      });
      res.json(successResponse({ message: '已启动下载', assetId, downloaded: false }));
    } catch (e: any) {
      res.status(500).json(errorResponse(e.message || '下载失败', 500));
    }
  });

  app.post('/api/assets/download/pause', (req: Request, res: Response) => {
    try {
      const assetId = (getRequestParam(req, 'assetId', '') as string).trim();
      if (!assetId) {
        res.status(400).json(errorResponse('请提供 assetId'));
        return;
      }
      const paused = pauseAssetDownload(assetId);
      res.json(successResponse({ assetId, paused }));
    } catch (e: any) {
      res.status(500).json(errorResponse(e.message || '暂停失败', 500));
    }
  });
}

// ==================== 导入处理的辅助函数 ====================

function processImport(req: Request, res: Response, wordbookName: string, wordList: string[]) {
  const RESERVED = new Set(['wordlist', 'favorites', 'errorbook']);
  if (wordbookName.startsWith('sys_') || RESERVED.has(wordbookName)) {
    res.status(400).json(errorResponse('该单词本不可导入，请选择其他单词本'));
    return;
  }

  if (!wordList || wordList.length === 0) {
    res.status(400).json(errorResponse('未找到任何单词，请检查文件内容'));
    return;
  }

  const wordbooks = loadWordbooks();
  if (!(wordbookName in wordbooks)) {
    wordbooks[wordbookName] = [];
  }

  const existingLemmas = new Set<string>();
  for (const w of wordbooks[wordbookName]) {
    const lemma = getLemma(w);
    existingLemmas.add(lemma.toLowerCase());
  }

  const seenLemmas = new Set<string>();
  const uniqueWordList: string[] = [];

  for (const word of wordList) {
    if (word.includes(' ')) {
      uniqueWordList.push(normalizeCaseByType(word));
    } else {
      const normalized = normalizeWord(word);
      const lemma = getLemma(word);
      const lemmaLower = lemma.toLowerCase();
      if (!seenLemmas.has(lemmaLower)) {
        seenLemmas.add(lemmaLower);
        uniqueWordList.push(normalized);
      }
    }
  }

  let wordCount = 0;
  let phraseCount = 0;
  const successWords: string[] = [];
  const failedWords: string[] = [];
  const duplicatedWords: string[] = [];

  for (const word of uniqueWordList) {
    if (word.includes(' ')) {
      phraseCount++;
    } else {
      wordCount++;
    }

    try {
      if (word.includes(' ')) {
        const wordLower = word.toLowerCase();
        const exists = wordbooks[wordbookName].some((w: string) => w.toLowerCase() === wordLower);
        if (!exists) {
          wordbooks[wordbookName].push(word);
          successWords.push(word);
        } else {
          duplicatedWords.push(word);
        }
      } else {
        const lemma = getLemma(word);
        if (!existingLemmas.has(lemma.toLowerCase())) {
          wordbooks[wordbookName].push(word);
          successWords.push(word);
          existingLemmas.add(lemma.toLowerCase());
        } else {
          duplicatedWords.push(word);
        }
      }
    } catch {
      failedWords.push(word);
    }
  }

  saveWordbooks(wordbooks);

  res.json(successResponse({
    total: wordList.length,
    word_count: wordCount,
    phrase_count: phraseCount,
    success_count: successWords.length,
    failed_count: failedWords.length,
    duplicated_count: duplicatedWords.length,
    success_words: successWords,
    failed_words: failedWords,
    duplicated_words: duplicatedWords,
  }));
}