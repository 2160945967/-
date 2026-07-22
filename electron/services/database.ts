import * as path from 'path';
import * as fs from 'fs';
import Database from 'better-sqlite3';
import { parse } from 'csv-parse';
import { LRUCache } from '../utils/cache';
import { ROOT_DIR, resolveAssetPath } from '../utils/helpers';

// Database instance type (extracted from the constructor)
type DatabaseInstance = InstanceType<typeof Database>;

// ==================== 路径解析 ====================
const MAIN_DB_PATH = resolveAssetPath('stardict.db');
const EXAMPLES_DB_PATH = resolveAssetPath('examples.db');
const STARDICT_CSV_PATH = path.join(ROOT_DIR, 'stardict.csv');
const LEMMA_PATH = resolveAssetPath('lemma.en.txt');
const WORDROOT_PATH = resolveAssetPath('wordroot.txt');
const RESEMBLE_PATH = resolveAssetPath('resemble.txt');

// ==================== 字段定义 ====================
const FIELDS = [
  'id', 'word', 'sw', 'phonetic', 'definition',
  'translation', 'pos', 'collins', 'oxford', 'tag', 'bnc', 'frq',
  'exchange', 'audio'
] as const;

// 字段名到索引的映射
const fieldIndex: Record<string, number> = {};
FIELDS.forEach((f, i) => { fieldIndex[f] = i; });

// ==================== 工具函数 ====================

function stripword(word: string): string {
  let result = '';
  for (const ch of word) {
    if ((ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || (ch >= '0' && ch <= '9')) {
      result += ch;
    }
  }
  return result.toLowerCase();
}

function cleanPhonetic(phonetic: string | null | undefined): string {
  if (!phonetic) return '';
  // 修复 stardict 数据源中 `\\\\:` 被错误编码为 `ɜː` 的问题
  return phonetic.replace(/\\\\\\\\:/g, 'ɜː');
}

function recordToObj(record: any): any {
  if (!record) return null;
  const word: any = {};
  for (let i = 0; i < FIELDS.length; i++) {
    word[FIELDS[i]] = record[FIELDS[i]];
  }
  if (word['phonetic']) {
    word['phonetic'] = cleanPhonetic(word['phonetic']);
  }
  return word;
}

// ==================== StarDict 词典 ====================

class StarDict {
  private db: DatabaseInstance | null;
  private dbPath: string;

  constructor(dbPath: string) {
    this.dbPath = dbPath;
    this.db = null;
    this.initTables();
  }

  private initTables(): void {
    const sql = `
      CREATE TABLE IF NOT EXISTS "stardict" (
        "id" INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL UNIQUE,
        "word" VARCHAR(64) COLLATE NOCASE NOT NULL UNIQUE,
        "sw" VARCHAR(64) COLLATE NOCASE NOT NULL,
        "phonetic" VARCHAR(64),
        "definition" TEXT,
        "translation" TEXT,
        "pos" VARCHAR(16),
        "collins" INTEGER DEFAULT(0),
        "oxford" INTEGER DEFAULT(0),
        "tag" VARCHAR(64),
        "bnc" INTEGER DEFAULT(NULL),
        "frq" INTEGER DEFAULT(NULL),
        "exchange" TEXT,
        "audio" TEXT
      );
      CREATE UNIQUE INDEX IF NOT EXISTS "stardict_1" ON stardict (id);
      CREATE UNIQUE INDEX IF NOT EXISTS "stardict_2" ON stardict (word);
      CREATE INDEX IF NOT EXISTS "stardict_3" ON stardict (sw, word collate nocase);
      CREATE INDEX IF NOT EXISTS "sd_1" ON stardict (word collate nocase);
    `;

    const conn = new Database(this.dbPath);
    conn.exec(sql);
    conn.close();
  }

  private getDb(): DatabaseInstance {
    if (!this.db) {
      this.db = new Database(this.dbPath);
    }
    return this.db;
  }

  /** 查询单个单词，key 可以是 id(number) 或 word(string) */
  query(key: string | number): any {
    const db = this.getDb();
    let record: any;
    if (typeof key === 'number') {
      record = db.prepare('SELECT * FROM stardict WHERE id = ?').get(key);
    } else {
      record = db.prepare('SELECT * FROM stardict WHERE word = ?').get(key);
    }
    return recordToObj(record);
  }

  /** 按标签统计单词数量（空格分隔的 tag 字段精确匹配） */
  countByTag(tag: string): number {
    const db = this.getDb();
    const row = db.prepare("SELECT COUNT(*) as cnt FROM stardict WHERE ' ' || tag || ' ' LIKE ?").get(`% ${tag} %`) as any;
    return row?.cnt || 0;
  }

  /** 按多个标签统计单词数量（OR 条件，空格分隔的 tag 字段精确匹配） */
  countByTags(tags: string[]): number {
    const db = this.getDb();
    const conditions = tags.map(() => "' ' || tag || ' ' LIKE ?").join(' OR ');
    const params = tags.map(t => `% ${t} %`);
    const row = db.prepare(`SELECT COUNT(*) as cnt FROM stardict WHERE ${conditions}`).get(...params) as any;
    return row?.cnt || 0;
  }

  /** 前缀匹配，返回 [id, word] 数组 */
  match(word: string, limit: number = 10): Array<[number, string]> {
    const db = this.getDb();
    const sql = 'SELECT id, word FROM stardict WHERE word >= ? ORDER BY word COLLATE NOCASE LIMIT ?';
    const rows = db.prepare(sql).all(word, limit) as Array<{ id: number; word: string }>;
    return rows.map((r: any) => [r.id, r.word] as [number, string]);
  }

  /**
   * 前缀匹配 + 智能排序
   * 排序优先级：用户考试类型 > 其他考试标签 > 柯林斯星级 > 词频
   */
  matchWithSort(
    prefix: string,
    limit: number = 10,
    userCategory: string = ''
  ): Array<{ id: number; word: string }> {
    const db = this.getDb();

    // 计算前缀上限（用于前缀范围查询）
    const lastChar = prefix.charAt(prefix.length - 1);
    const prefixUpper = prefix
      ? prefix.slice(0, -1) + String.fromCharCode(lastChar.charCodeAt(0) + 1)
      : '';

    const sql = `
      SELECT id, word, tag, collins, frq
      FROM stardict
      WHERE word >= ? AND word < ?
      ORDER BY word COLLATE NOCASE
      LIMIT 500
    `;
    const rows = db.prepare(sql).all(prefix, prefixUpper) as Array<{
      id: number; word: string; tag: string | null; collins: number | null; frq: number | null;
    }>;

    const examTags: Record<string, number> = {
      'xx': 1, 'zk': 2, 'gk': 3, 'cet4': 4, 'cet6': 5,
      'tem4': 6, 'tem8': 7, 'ky': 8, 'toefl': 9, 'ielts': 10, 'gre': 11
    };

    const hasSpaceOrHyphen = prefix.includes(' ') || prefix.includes('-');

    const sortKey = (row: any): [number, number, number, number, number] => {
      const tagLower = (row.tag || '').toLowerCase();
      const isPhrase = row.word.includes(' ') || row.word.includes('-');

      // 1. 用户输入词组时，优先展示词组
      const phrasePriority = (hasSpaceOrHyphen && isPhrase) ? 0 : 1;

      // 2. 用户选择的考试类型（空格分隔精确匹配）
      const paddedTag = ' ' + tagLower + ' ';
      const userMatch = (userCategory && paddedTag.includes(' ' + userCategory + ' ')) ? 0 : 1;

      // 3. 其他考试标签优先级（空格分隔精确匹配）
      let tagPriority = 0;
      if (tagLower) {
        for (const [etag, pri] of Object.entries(examTags)) {
          if (paddedTag.includes(' ' + etag + ' ')) {
            tagPriority = 10 - pri;
            break;
          }
        }
      }

      // 4. 柯林斯星级（越高越好，取负使高星级排前面）
      const collinsScore = -(row.collins || 0);

      // 5. 词频（越小越常用，null 排后面）
      const frqScore = row.frq !== null ? row.frq : 999999;

      return [phrasePriority, userMatch, tagPriority, collinsScore, frqScore];
    };

    rows.sort((a, b) => {
      const ka = sortKey(a);
      const kb = sortKey(b);
      for (let i = 0; i < 5; i++) {
        if (ka[i] !== kb[i]) return ka[i] - kb[i];
      }
      return 0;
    });

    return rows.slice(0, limit).map((row: any) => ({
      id: row.id,
      word: row.word
    }));
  }

  /** 按中文释义模糊搜索，返回单词、释义 */
  searchByChinese(keyword: string, limit: number = 50): Array<{ id: number; word: string; translation: string }> {
    const db = this.getDb();
    const sql = `
      SELECT id, word, translation
      FROM stardict
      WHERE translation LIKE ?
      ORDER BY CASE WHEN frq IS NULL THEN 1 ELSE 0 END,
               frq ASC,
               collins DESC
      LIMIT ?
    `;
    const rows = db.prepare(sql).all(`%${keyword}%`, limit) as any[];
    return rows.map((r: any) => ({
      id: r.id,
      word: r.word,
      translation: r.translation || ''
    }));
  }

  /** 批量查询，keys 可以是 id 或 word 的混合数组 */
  queryBatch(keys: Array<string | number>): any[] {
    if (!keys) return [];
    if (keys.length === 0) return [];

    const db = this.getDb();
    const queries: string[] = [];
    const params: any[] = [];

    for (const key of keys) {
      if (typeof key === 'number') {
        queries.push('id = ?');
      } else if (key !== null && key !== undefined) {
        queries.push('word = ?');
      }
      params.push(key);
    }

    const sql = 'SELECT * FROM stardict WHERE ' + queries.join(' OR ');

    const queryWord: Record<string, any> = {};
    const queryId: Record<number, any> = {};

    const rows = db.prepare(sql).all(...params) as any[];
    for (const row of rows) {
      const obj = recordToObj(row);
      queryWord[obj.word.toLowerCase()] = obj;
      queryId[obj.id] = obj;
    }

    return keys.map(key => {
      if (typeof key === 'number') {
        return queryId[key] || null;
      } else if (key !== null && key !== undefined) {
        return queryWord[key.toLowerCase()] || null;
      }
      return null;
    });
  }

  /** 单词总数 */
  count(): number {
    const db = this.getDb();
    const row = db.prepare('SELECT COUNT(*) as cnt FROM stardict').get() as { cnt: number };
    return row.cnt;
  }

  /** 分页获取所有单词（用于离线发音包批量下载） */
  getAllWords(limit: number = -1, offset: number = 0): string[] {
    const db = this.getDb();
    let sql = 'SELECT word FROM stardict ORDER BY word COLLATE NOCASE';
    const params: any[] = [];
    if (limit > 0) {
      sql += ' LIMIT ? OFFSET ?';
      params.push(limit, offset);
    }
    const rows = db.prepare(sql).all(...params) as Array<{ word: string }>;
    return rows.map(r => r.word);
  }

  /** 关闭数据库连接 */
  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}

// ==================== 例句查询 ====================

const examplesCache = new LRUCache<any[]>(500);

function findExamplesForWord(word: string): any[] {
  const targetWord = word.toLowerCase();

  const cached = examplesCache.get(targetWord);
  if (cached !== undefined) return cached;

  const examples: any[] = [];

  try {
    if (!fs.existsSync(EXAMPLES_DB_PATH)) return examples;

    const conn = new Database(EXAMPLES_DB_PATH, { readonly: true });
    const stmt = conn.prepare(`
      SELECT s.id, s.text as eng_text, t.cmn_id, s_cmn.text as cmn_text
      FROM sentences s
      JOIN word_examples w ON s.id = w.sentence_id
      JOIN translations t ON s.id = t.eng_id
      JOIN sentences s_cmn ON t.cmn_id = s_cmn.id
      WHERE w.word = ?
      LIMIT 50
    `);
    const rows = stmt.all(targetWord) as any[];

    for (const row of rows) {
      examples.push({
        id: String(row.id),
        lang: 'eng',
        text: row.eng_text,
        translation: row.cmn_text
      });
    }

    conn.close();
  } catch (e) {
    console.error('例句查询失败:', e);
  }

  examplesCache.put(targetWord, examples);
  return examples;
}

// ==================== LemmaDB 词干数据库 ====================

class LemmaDB {
  private lemmaMap: Record<string, string> = {};   // 词形 -> 词干
  private inflections: Record<string, string[]> = {}; // 词干 -> 词形列表

  constructor(filePath?: string) {
    const fp = filePath || LEMMA_PATH;
    this.load(fp);
  }

  private load(filePath: string): void {
    if (!fs.existsSync(filePath)) {
      console.warn(`警告：未找到文件 ${filePath}`);
      return;
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith(';')) continue;

      const pos = trimmed.indexOf('->');
      if (pos <= 0) continue;

      const lemmaPart = trimmed.substring(0, pos).trim();
      const inflectionPart = trimmed.substring(pos + 2).trim();

      // 提取词干（去掉 /词频 部分）
      let lemma = lemmaPart;
      const slashIdx = lemma.indexOf('/');
      if (slashIdx >= 0) {
        lemma = lemma.substring(0, slashIdx);
      }
      lemma = lemma.toLowerCase();

      // 提取词形变化列表
      const inflectionsList = inflectionPart.split(',')
        .map(w => w.split('/')[0].trim().toLowerCase())
        .filter(w => w.length > 0);

      this.inflections[lemma] = inflectionsList;

      for (const w of inflectionsList) {
        this.lemmaMap[w] = lemma;
      }
      // 词干本身也指向自己
      this.lemmaMap[lemma] = lemma;
    }
  }

  /** 获取单词的词干 */
  getLemma(word: string): string | null {
    return this.lemmaMap[word.toLowerCase()] || null;
  }

  /** 获取词干的所有词形变化 */
  getInflections(lemma: string): string[] {
    return this.inflections[lemma.toLowerCase()] || [];
  }

  /** 查找单词的所有相关词形（包括词干和所有变体，排除自身） */
  findRelatedForms(word: string): string[] {
    const wordLower = word.toLowerCase();
    const lemma = this.getLemma(wordLower);
    if (!lemma) return [];

    let forms = this.getInflections(lemma);
    // 确保词干也在列表中
    if (!forms.includes(lemma)) {
      forms = [lemma, ...forms];
    }
    // 排除查询词本身
    return forms.filter(w => w !== wordLower);
  }
}

// ==================== WordRootDB 词根数据库 ====================

class WordRootDB {
  private rootData: Record<string, any> = {};       // 词根/词缀 -> 详细信息
  private wordToRoots: Record<string, string[]> = {}; // 单词 -> 相关词根列表

  constructor(filePath?: string) {
    const fp = filePath || WORDROOT_PATH;
    this.load(fp);
  }

  private load(filePath: string): void {
    if (!fs.existsSync(filePath)) {
      console.warn(`警告：未找到文件 ${filePath}`);
      return;
    }

    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      this.rootData = JSON.parse(content);

      // 构建单词到词根的反向索引
      for (const [root, info] of Object.entries(this.rootData)) {
        if (info.example) {
          for (const word of info.example) {
            const wordLower = word.toLowerCase();
            if (!this.wordToRoots[wordLower]) {
              this.wordToRoots[wordLower] = [];
            }
            this.wordToRoots[wordLower].push(root);
          }
        }
      }
    } catch (e) {
      console.error(`加载词根文件 wordroot.txt 出错: ${e}`);
    }
  }

  /** 获取单词相关的词根 */
  getRootsForWord(word: string): string[] {
    return this.wordToRoots[word.toLowerCase()] || [];
  }

  /** 获取词根的详细信息 */
  getRootInfo(root: string): any {
    return this.rootData[root] || null;
  }
}

// ==================== ResembleDB 形近词数据库 ====================

interface ResembleGroup {
  words: string[];
  explanation: string[];
}

class ResembleDB {
  private groups: ResembleGroup[] = [];
  private wordToGroups: Record<string, number[]> = {};  // 单词(小写) -> 所属词组索引列表
  private wordVariants: Record<string, Set<string>> = {}; // 单词(小写) -> 原始大小写集合

  constructor(filePath?: string) {
    const fp = filePath || RESEMBLE_PATH;
    this.load(fp);
  }

  private load(filePath: string): void {
    if (!fs.existsSync(filePath)) {
      console.warn(`警告：未找到文件 ${filePath}`);
      return;
    }

    let currentGroup: ResembleGroup | null = null;

    const content = fs.readFileSync(filePath, 'utf-8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();

      if (trimmed.startsWith('%')) {
        // 新词组开始
        if (currentGroup) {
          this.groups.push(currentGroup);
        }

        const wordsStr = trimmed.substring(1).trim();
        const words = wordsStr.split(',').map(w => w.trim()).filter(w => w.length > 0);
        currentGroup = { words, explanation: [] };

        // 为每个单词建立索引
        for (const word of words) {
          const wordLower = word.toLowerCase();
          if (!this.wordToGroups[wordLower]) {
            this.wordToGroups[wordLower] = [];
          }
          this.wordToGroups[wordLower].push(this.groups.length);

          if (!this.wordVariants[wordLower]) {
            this.wordVariants[wordLower] = new Set();
          }
          this.wordVariants[wordLower].add(word);
        }
      } else if (currentGroup && trimmed) {
        currentGroup.explanation.push(trimmed);
      }
    }

    // 添加最后一个词组
    if (currentGroup) {
      this.groups.push(currentGroup);
    }
  }

  /** 获取单词的形近词/同义词 */
  getSimilarWords(word: string): string[] {
    const wordLower = word.toLowerCase();
    const groupIndices = this.wordToGroups[wordLower] || [];

    const similarWords: string[] = [];
    for (const idx of groupIndices) {
      if (idx < this.groups.length) {
        const group = this.groups[idx];
        const others = group.words.filter(w => w !== word);
        similarWords.push(...others);
      }
    }

    // 去重
    return [...new Set(similarWords)];
  }

  /** 获取单词所属的词组详细信息 */
  getGroupInfo(word: string): ResembleGroup[] {
    const wordLower = word.toLowerCase();
    const groupIndices = this.wordToGroups[wordLower] || [];

    return groupIndices
      .filter(idx => idx < this.groups.length)
      .map(idx => ({ ...this.groups[idx] }));
  }
}

// ==================== 增强信息 ====================

function getWordEnhancedInfo(word: string): any {
  const lemmaDB = getLemmaDB();
  const wordrootDB = getWordRootDB();
  const resembleDB = getResembleDB();

  const wordLower = word.toLowerCase();

  const info: any = {
    word,
    lemma: lemmaDB.getLemma(wordLower),
    relatedForms: lemmaDB.findRelatedForms(word),
    roots: [] as any[],
    similar_words: resembleDB.getSimilarWords(word),
    resemble_groups: resembleDB.getGroupInfo(word)
  };

  const roots = wordrootDB.getRootsForWord(wordLower);
  for (const root of roots) {
    const rootInfo = wordrootDB.getRootInfo(root);
    if (rootInfo) {
      info.roots.push({ root, info: rootInfo });
    }
  }

  return info;
}

// ==================== 单例实例 ====================

let _mainDb: StarDict | null = null;
let _lemmaDB: LemmaDB | null = null;
let _wordrootDB: WordRootDB | null = null;
let _resembleDB: ResembleDB | null = null;

// ==================== 从 CSV 生成词典 ====================

/** 检查词典数据库是否为空或不存在 */
function isDbEmpty(dbPath: string): boolean {
  if (!fs.existsSync(dbPath)) return true;
  try {
    const db = new Database(dbPath, { readonly: true });
    const row = db.prepare('SELECT COUNT(*) as cnt FROM stardict').get() as { cnt: number } | undefined;
    db.close();
    return !row || row.cnt === 0;
  } catch {
    return true;
  }
}

/** 首次启动时从 CSV 合并生成 stardict.db（流式解析，避免内存爆炸） */
function buildStardictDbFromCsvs(outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    console.log('首次启动，正在从 CSV 生成词典数据库，请稍候...');
    const t0 = Date.now();

    if (fs.existsSync(outputPath)) {
      fs.unlinkSync(outputPath);
    }

    const db = new Database(outputPath);
    db.exec(`
      CREATE TABLE IF NOT EXISTS "stardict" (
        "id" INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL UNIQUE,
        "word" VARCHAR(64) COLLATE NOCASE NOT NULL UNIQUE,
        "sw" VARCHAR(64) COLLATE NOCASE NOT NULL,
        "phonetic" VARCHAR(64),
        "definition" TEXT,
        "translation" TEXT,
        "pos" VARCHAR(16),
        "collins" INTEGER DEFAULT(0),
        "oxford" INTEGER DEFAULT(0),
        "tag" VARCHAR(64),
        "bnc" INTEGER DEFAULT(NULL),
        "frq" INTEGER DEFAULT(NULL),
        "exchange" TEXT,
        "audio" TEXT
      );
      CREATE UNIQUE INDEX IF NOT EXISTS "stardict_1" ON stardict (id);
      CREATE UNIQUE INDEX IF NOT EXISTS "stardict_2" ON stardict (word);
      CREATE INDEX IF NOT EXISTS "stardict_3" ON stardict (sw, word collate nocase);
      CREATE INDEX IF NOT EXISTS "sd_1" ON stardict (word collate nocase);
    `);

    const insert = db.prepare(`
      INSERT INTO stardict (word, sw, phonetic, definition, translation, pos, collins, oxford, tag, bnc, frq, exchange, audio)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertBatch = db.transaction((rows: any[][]) => {
      for (const row of rows) {
        insert.run(...row);
      }
    });

    const csvFiles = [
      { path: STARDICT_CSV_PATH, name: '词典 stardict.csv' }
    ];

    const seen = new Set<string>();
    let totalImported = 0;

    function processFile(index: number): void {
      if (index >= csvFiles.length) {
        db.close();
        console.log(`词典数据库生成完成：共 ${totalImported} 条 (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
        resolve();
        return;
      }

      const csvFile = csvFiles[index];
      if (!fs.existsSync(csvFile.path)) {
        console.log(`跳过 ${csvFile.name}：文件不存在`);
        processFile(index + 1);
        return;
      }

      console.log(`正在导入 ${csvFile.name}...`);
      const tFile = Date.now();
      let fileCount = 0;
      const batch: any[][] = [];
      const BATCH_SIZE = 1000;

      const parser = parse({
        columns: true,
        skip_empty_lines: true,
        relax_column_count: true,
        trim: true
      });

      function flushBatch(): void {
        if (batch.length === 0) return;
        insertBatch(batch);
        batch.length = 0;
      }

      fs.createReadStream(csvFile.path, { encoding: 'utf-8' })
        .pipe(parser)
        .on('data', (row: Record<string, string>) => {
          const word = row.word;
          if (!word) return;

          const lower = word.toLowerCase();
          if (seen.has(lower)) return;
          seen.add(lower);

          batch.push([
            word,
            stripword(word),
            row.phonetic || '',
            row.definition || '',
            row.translation || '',
            row.pos || '',
            parseInt(row.collins) || 0,
            parseInt(row.oxford) || 0,
            row.tag || '',
            row.bnc ? parseInt(row.bnc) : null,
            row.frq ? parseInt(row.frq) : null,
            row.exchange || '',
            row.audio || ''
          ]);

          fileCount++;
          totalImported++;

          if (batch.length >= BATCH_SIZE) {
            flushBatch();
          }

          if (fileCount % 10000 === 0) {
            console.log(`  ${csvFile.name}: 已导入 ${fileCount} 条...`);
          }
        })
        .on('end', () => {
          flushBatch();
          console.log(`${csvFile.name} 导入完成：${fileCount} 条 (${((Date.now() - tFile) / 1000).toFixed(1)}s)`);
          processFile(index + 1);
        })
        .on('error', (err: any) => {
          console.error(`${csvFile.name} 导入失败:`, err);
          db.close();
          reject(err);
        });
    }

    processFile(0);
  });
}

// ==================== 公共 API ====================

/** 初始化词典数据库 */
async function initDatabases(): Promise<void> {
  if (isDbEmpty(MAIN_DB_PATH)) {
    await buildStardictDbFromCsvs(MAIN_DB_PATH);
  }

  console.log('正在初始化词典...');
  const t0 = Date.now();
  _mainDb = new StarDict(MAIN_DB_PATH);
  const count = _mainDb.count();
  console.log(`词典准备就绪：${count} 个单词 (${((Date.now() - t0) / 1000).toFixed(3)}s)`);
}

/** 获取词典数据库实例 */
function getMainDb(): StarDict | null {
  return _mainDb;
}

/** 获取例句数据库路径（直接返回路径，由调用方自行连接） */
function getExamplesDbPath(): string {
  return EXAMPLES_DB_PATH;
}

/** 获取例句数据库连接 */
function getExamplesDb(): DatabaseInstance | null {
  if (!fs.existsSync(EXAMPLES_DB_PATH)) return null;
  return new Database(EXAMPLES_DB_PATH, { readonly: true });
}

function getLemmaDB(): LemmaDB {
  if (!_lemmaDB) {
    _lemmaDB = new LemmaDB();
  }
  return _lemmaDB;
}

function getWordRootDB(): WordRootDB {
  if (!_wordrootDB) {
    _wordrootDB = new WordRootDB();
  }
  return _wordrootDB;
}

function getResembleDB(): ResembleDB {
  if (!_resembleDB) {
    _resembleDB = new ResembleDB();
  }
  return _resembleDB;
}

export {
  StarDict,
  LemmaDB,
  WordRootDB,
  ResembleDB,
  initDatabases,
  getLemmaDB,
  getWordRootDB,
  getResembleDB,
  getWordEnhancedInfo,
  findExamplesForWord,
  getMainDb,
  getExamplesDb,
  getExamplesDbPath,
  buildStardictDbFromCsvs
};