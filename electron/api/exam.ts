import * as path from 'path';
import * as fs from 'fs';
import { Request, Response } from 'express';
import {
  ROOT_DIR, APP_ROOT_DIR, ASSETS_DIR,
  successResponse, errorResponse,
} from '../utils/helpers';
import { getMainDb, getLemmaDB } from '../services/database';

// ==================== 静态 JSON（随 dist 打包，dev 下回退 public/） ====================
function publicFile(rel: string): string | null {
  const built = path.join(APP_ROOT_DIR, 'dist', rel);
  if (fs.existsSync(built)) return built;
  const dev = path.join(ROOT_DIR, 'public', rel);
  if (fs.existsSync(dev)) return dev;
  return null;
}

function readPublicJson(rel: string): any {
  const f = publicFile(rel);
  if (!f) throw new Error(`缺少资源文件: ${rel}`);
  return JSON.parse(fs.readFileSync(f, 'utf8'));
}

// ==================== 四级核心词词表（来自《英语四级 你还在背单词吗》index.json） ====================
let cet4Vocab: Set<string> | null = null;
function getCet4Vocab(): Set<string> {
  if (cet4Vocab) return cet4Vocab;
  const set = new Set<string>();
  try {
    const idx = readPublicJson(path.join('wordbooks', 'cet4-beidanci', 'index.json')) as Record<string, string[]>;
    Object.values(idx).forEach(arr => {
      (arr || []).forEach(w => { if (w) set.add(String(w).toLowerCase()); });
    });
  } catch (e) {
    console.error('加载四级词表失败:', (e as Error).message);
  }
  cet4Vocab = set;
  return set;
}

// 常见功能词（双保险，词表求交后理论上已过滤绝大多数）
const STOP_WORDS = new Set([
  'the', 'a', 'an', 'is', 'am', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'having', 'do', 'does', 'did', 'doing', 'will', 'would',
  'shall', 'should', 'can', 'could', 'may', 'might', 'must', 'need', 'dare',
  'of', 'in', 'on', 'at', 'to', 'for', 'with', 'by', 'from', 'as', 'into',
  'onto', 'upon', 'about', 'over', 'under', 'between', 'through', 'during',
  'before', 'after', 'above', 'below', 'up', 'down', 'out', 'off', 'again',
  'it', 'its', 'this', 'that', 'these', 'those', 'they', 'them', 'their',
  'there', 'here', 'and', 'or', 'but', 'not', 'no', 'nor', 'so', 'if', 'then',
  'than', 'such', 'we', 'us', 'our', 'you', 'your', 'he', 'him', 'his', 'she',
  'her', 'hers', 'i', 'me', 'my', 'mine', 'what', 'which', 'who', 'whom',
  'whose', 'when', 'where', 'why', 'how', 'all', 'any', 'both', 'each', 'few',
  'more', 'most', 'other', 'some', 'only', 'own', 'same', 'too', 'very',
  'just', 'now', 'also', 'because', 'while', 'whereas', 'although', 'though',
  'however', 'therefore', 'thus', 'hence', 'one', 'two', 'first', 'new',
]);

// ==================== 四级词书词条（精简释义 / 音标，来自《英语四级 你还在背单词吗》lessons） ====================
// 核心词芯片上的精简释义优先用词书自己的释义；跳转词典查词仍展示 ECDict/StarDict 完整词条（互不影响）。
interface Cet4BookEntry { ph: string; mean: string }
let cet4Book: Map<string, Cet4BookEntry> | null = null;
function getCet4Book(): Map<string, Cet4BookEntry> {
  if (cet4Book) return cet4Book;
  const map = new Map<string, Cet4BookEntry>();
  try {
    const idx = readPublicJson(path.join('wordbooks', 'cet4-beidanci', 'index.json')) as Record<string, string[]>;
    Object.keys(idx).forEach(id => {
      try {
        const f = readPublicJson(path.join('wordbooks', 'cet4-beidanci', 'lessons', `${id}.json`)) as any;
        (f.words || []).forEach((w: any) => {
          const key = String(w.w || '').toLowerCase().trim();
          if (!key || map.has(key)) return;
          const pos: any[] = Array.isArray(w.pos) ? w.pos : [];
          const parts = pos.slice(0, 2).map((x: any) => {
            const pp = String(x.p || '').trim().replace(/\.$/, '');
            const d = String(x.d || '').trim();
            // 释义必须含汉字或字母；过滤被错误拆分成纯符号的条目（如 {p:'num', d:'&'}）
            if (!d || !/[\u4e00-\u9fa5a-zA-Z]/.test(d)) return '';
            return pp ? `${pp}. ${d}` : d;
          }).filter(Boolean);
          const mean = Array.from(new Set(parts)).join('；');
          if (mean) map.set(key, { ph: String(w.ph || ''), mean });
        });
      } catch { /* 单个课文件缺失则跳过 */ }
    });
  } catch (e) {
    console.error('加载四级词书词条失败:', (e as Error).message);
  }
  cet4Book = map;
  return map;
}

interface Keyword { w: string; ph: string; mean: string; count: number }

/** 从文本提取四级核心词：词形还原后与四级词表求交，按频次排序，批量补释义 */
function extractKeywords(text: string, topN: number): Keyword[] {
  const vocab = getCet4Vocab();
  if (vocab.size === 0) return [];
  const lemmaDb = getLemmaDB();
  const tokens = text.toLowerCase().match(/[a-z][a-z'-]{2,}/g) || [];
  const freq = new Map<string, number>();
  for (const raw of tokens) {
    const t = raw.replace(/^'+|'+$/g, '');
    if (t.length < 3 || STOP_WORDS.has(t)) continue;
    let lemma = '';
    try { lemma = lemmaDb.getLemma(t) || ''; } catch { lemma = ''; }
    const key = lemma && vocab.has(lemma) ? lemma : (vocab.has(t) ? t : '');
    if (!key) continue;
    freq.set(key, (freq.get(key) || 0) + 1);
  }
  const ranked = [...freq.entries()]
    .sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0]))
    .slice(0, topN);
  if (ranked.length === 0) return [];
  const words = ranked.map(r => r[0]);
  const countOf = new Map(ranked);

  const book = getCet4Book();
  const db = getMainDb();
  let objs: any[] = [];
  try { objs = db ? (db.queryBatch(words) || []) : []; } catch { objs = []; }

  const out: Keyword[] = [];
  words.forEach((w, i) => {
    const count = countOf.get(w) || 1;
    // 1) 优先用四级词书自己的精简释义与音标
    const be = book.get(w.toLowerCase());
    if (be && be.mean) {
      out.push({ w, ph: be.ph, mean: be.mean, count });
      return;
    }
    // 2) 词书缺该词时回退 StarDict/ECDict
    const o = objs[i];
    if (!o) return;
    const mean = String(o.translation || '')
      .split(/[；;\n]/).map(x => x.trim()).filter(Boolean).slice(0, 2).join('；');
    if (!mean) return;
    out.push({ w, ph: o.phonetic || '', mean, count });
  });
  return out;
}

// 关键词结果缓存（同一篇/套不重复分词查库）
const keywordCache = new Map<string, Keyword[]>();
function cachedKeywords(key: string, text: string, topN: number): Keyword[] {
  const hit = keywordCache.get(key);
  if (hit) return hit;
  const val = extractKeywords(text, topN);
  if (keywordCache.size > 200) keywordCache.clear();
  keywordCache.set(key, val);
  return val;
}

// 取某篇阅读 / 某套听力的全文（用于核心词提取）
function readingText(level: string, n: number): string {
  const data = readPublicJson(path.join('exams', 'reading', `${level}.json`));
  const art = data.articles && data.articles[n - 1];
  if (!art) throw new Error('未找到该阅读篇目');
  const parts: string[] = [...(art.p || [])];
  (art.q || []).forEach((q: any) => { parts.push(q.s || ''); (q.o || []).forEach((x: string) => parts.push(x)); });
  return parts.join('\n');
}

function listeningText(id: string): string {
  const data = readPublicJson(path.join('exams', 'listening', 'tests', `${id}.json`));
  const parts: string[] = [];
  (data.transcript || []).forEach((b: any) => (b.paras || []).forEach((p: string) => parts.push(p)));
  if (parts.length === 0) {
    (data.sections || []).forEach((sec: any) =>
      (sec.clips || []).forEach((c: any) => (c.questions || []).forEach((q: any) => {
        parts.push(q.s || ''); (q.o || []).forEach((x: string) => parts.push(x));
      })));
  }
  return parts.join('\n');
}

// ==================== 听力音频（不打包，resource 流式发送，支持 Range） ====================
const LISTENING_BANK_REL = path.join('模拟题', 'CET4_Listening_Bank');
function findListeningWav(id: string): string | null {
  if (!/^Test_\d{3}$/.test(id)) return null; // 严格校验，防路径穿越
  const rel = path.join(LISTENING_BANK_REL, id, 'complete_test.wav');
  const candidates = [
    path.join(ASSETS_DIR, rel),
    path.join(ROOT_DIR, rel),
    path.join(ROOT_DIR, 'resource', rel),
  ];
  for (const c of candidates) {
    try { if (fs.existsSync(c)) return c; } catch { /* ignore */ }
  }
  return null;
}
let listeningStatusCache: { total: number; available: number; ids: string[] } | null = null;

export function setupExamRoutes(app: any): void {
  // 听力音频可用状态
  app.get('/api/exam/listening-status', (req: Request, res: Response) => {
    try {
      if (!listeningStatusCache) {
        const ids: string[] = [];
        for (let i = 1; i <= 100; i++) {
          const id = `Test_${String(i).padStart(3, '0')}`;
          if (findListeningWav(id)) ids.push(id);
        }
        listeningStatusCache = { total: 100, available: ids.length, ids };
      }
      res.json(successResponse(listeningStatusCache));
    } catch (e: any) {
      res.status(500).json(errorResponse(e.message || '获取听力资源状态失败', 500));
    }
  });

  // 单套听力音频流（express sendFile 自动处理 Range，网页 audio 可拖动进度）
  app.get('/api/exam/listening-audio/:id', (req: Request, res: Response) => {
    try {
      const id = String(req.params.id || '');
      if (!/^Test_\d{3}$/.test(id)) {
        res.status(400).json(errorResponse('听力套卷编号无效', 400));
        return;
      }
      const file = findListeningWav(id);
      if (!file) {
        res.status(404).json(errorResponse(
          '未找到听力音频资源：音频体积较大未随程序打包，请将 CET4_Listening_Bank 放入 resource/模拟题 目录，或安装听力资源包。', 404));
        return;
      }
      res.set('Content-Type', 'audio/wav');
      res.set('Accept-Ranges', 'bytes');
      res.sendFile(file);
    } catch (e: any) {
      res.status(500).json(errorResponse(e.message || '获取听力音频失败', 500));
    }
  });

  // 核心词：?type=reading&level=cet4&n=1  或  ?type=listening&id=Test_001
  app.get('/api/exam/keywords', (req: Request, res: Response) => {
    try {
      const type = String(req.query.type || '');
      let key = '';
      let text = '';
      let topN = 24;
      if (type === 'reading') {
        const level = String(req.query.level || '');
        const n = parseInt(String(req.query.n || ''), 10);
        if (level !== 'cet4' && level !== 'cet6') {
          res.status(400).json(errorResponse('难度参数无效', 400)); return;
        }
        if (!Number.isInteger(n) || n < 1 || n > 399) {
          res.status(400).json(errorResponse('篇目编号无效', 400)); return;
        }
        key = `reading:${level}:${n}`;
        text = readingText(level, n);
      } else if (type === 'listening') {
        const id = String(req.query.id || '');
        if (!/^Test_\d{3}$/.test(id)) {
          res.status(400).json(errorResponse('听力套卷编号无效', 400)); return;
        }
        key = `listening:${id}`;
        text = listeningText(id);
        topN = 28;
      } else {
        res.status(400).json(errorResponse('类型参数无效', 400)); return;
      }
      res.json(successResponse({ keywords: cachedKeywords(key, text, topN) }));
    } catch (e: any) {
      res.status(500).json(errorResponse(e.message || '提取核心词失败', 500));
    }
  });
}
