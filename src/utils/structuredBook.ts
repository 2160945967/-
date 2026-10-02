// 结构化词书（《英语四级 你还在背单词吗》）加载与 source 编解码
// 数据位于 public/wordbooks/cet4-beidanci/：
//   manifest.json  目录树（模块→单元→课，含词数/词群）
//   index.json     轻量词索引 {lessonId: [word,...]}，仅用于选词进度统计
//   lessons/*.json 完整课数据（音标/释义/记忆法/例句/真题/派生词）

export const BOOK_ID = 'cet4-beidanci';
export const BOOK_NAME = '英语四级 · 你还在背单词吗';
const BOOK_SHORT = '四级词书';
const SOURCE_PREFIX = `cb:${BOOK_ID}:`;

// ---------- 数据类型（对应 JSON 短键） ----------
export interface BookPos { p: string; d: string }
export interface BookDer { w: string; ph: string; pos: BookPos[] }
export interface BookExample { en: string; zh: string; y?: string }
export interface BookWord {
    w: string;
    ans?: string[];
    ph: string;
    pos: BookPos[];
    mem?: string;
    ex?: BookExample | null;
    real?: BookExample | null;
    der?: BookDer[];
    g?: number;
    gn?: string;
    /** 派生词条目专用：来源主词（主词条目该字段为空） */
    derivedFrom?: string;
}
export interface BookLessonFile { id: string; unit: number; lesson: number; words: BookWord[] }
export interface BookManifestGroup { no: number; name: string; count: number }
export interface BookManifestLesson {
    id: string; idx: number; name: string; count: number;
    file: string; groups: BookManifestGroup[];
}
export interface BookManifestUnit { id: string; idx: number; name: string; lessons: BookManifestLesson[] }
export interface BookManifestPart { id: string; name: string; units: BookManifestUnit[] }
export interface BookManifest {
    id: string; name: string; author?: string; description?: string;
    parts: BookManifestPart[]; totalCount: number; lessonCount: number;
}
export interface BookExtra {
    mem?: string;
    ex?: BookExample | null;
    real?: BookExample | null;
    der?: BookDer[];
    gn?: string;
    /** 派生词：来源主词词形 */
    derivedFrom?: string;
}

// ---------- 资源路径（dev 根路径 / 打包后相对 index.html） ----------
const BASE_URL = (import.meta.env.BASE_URL || '/').replace(/\/$/, '');
const BOOK_URL = `${BASE_URL}/wordbooks/${BOOK_ID}`;

// ---------- 内存缓存 ----------
let manifestPromise: Promise<BookManifest> | null = null;
let indexPromise: Promise<Record<string, string[]>> | null = null;
let indexResolved: Record<string, string[]> | null = null;
// 派生词轻量索引 {lessonId: [derWord,...]}，仅用于选词进度计数
let derPromise: Promise<Record<string, string[]>> | null = null;
let derResolved: Record<string, string[]> | null = null;
const lessonCache = new Map<string, BookWord[]>();
const lessonPromiseCache = new Map<string, Promise<BookWord[]>>();

function fetchJson<T>(url: string): Promise<T> {
    return fetch(url).then(r => {
        if (!r.ok) throw new Error(`加载词书资源失败: ${url} (${r.status})`);
        return r.json() as Promise<T>;
    });
}

export function loadManifest(): Promise<BookManifest> {
    if (!manifestPromise) {
        manifestPromise = fetchJson<BookManifest>(`${BOOK_URL}/manifest.json`);
        manifestPromise.catch(() => { manifestPromise = null; });
    }
    return manifestPromise;
}

export function loadIndex(): Promise<Record<string, string[]>> {
    if (!indexPromise) {
        indexPromise = fetchJson<Record<string, string[]>>(`${BOOK_URL}/index.json`)
            .then(idx => { indexResolved = idx; return idx; });
        indexPromise.catch(() => { indexPromise = null; });
    }
    return indexPromise;
}

export function loadDerIndex(): Promise<Record<string, string[]>> {
    if (!derPromise) {
        derPromise = fetchJson<Record<string, string[]>>(`${BOOK_URL}/der.json`)
            .then(d => { derResolved = d || {}; return derResolved; });
        derPromise.catch(() => { derPromise = null; });
    }
    return derPromise;
}

export function getDerIndexSync(): Record<string, string[]> | null {
    return derResolved;
}

export function ensureDerIndexLoaded(): Promise<Record<string, string[]>> {
    return loadDerIndex();
}

export function loadLesson(id: string): Promise<BookWord[]> {
    const cached = lessonCache.get(id);
    if (cached) return Promise.resolve(cached);
    let p = lessonPromiseCache.get(id);
    if (!p) {
        p = fetchJson<BookLessonFile>(`${BOOK_URL}/lessons/${id}.json`).then(f => {
            lessonCache.set(id, f.words);
            return f.words;
        });
        p.catch(() => lessonPromiseCache.delete(id));
        lessonPromiseCache.set(id, p);
    }
    return p;
}

/** 应用启动时静默预热（失败不影响其它功能） */
export function warmupStructuredBook(): void {
    loadManifest().catch(() => {});
    loadIndex().catch(() => {});
    loadDerIndex().catch(() => {});
}

// ---------- source 编解码 ----------
export function isStructuredSource(value: string): boolean {
    return typeof value === 'string' && value.startsWith(SOURCE_PREFIX);
}

export interface ParsedSource { all: boolean; lessonIds: string[] }

export function parseSource(value: string): ParsedSource | null {
    if (!isStructuredSource(value)) return null;
    const body = value.slice(SOURCE_PREFIX.length);
    if (body === 'all') return { all: true, lessonIds: [] };
    const ids = body.split(',').map(s => s.trim()).filter(Boolean);
    return { all: false, lessonIds: ids };
}

export function encodeSource(selection: 'all' | string[]): string {
    if (selection === 'all') return `${SOURCE_PREFIX}all`;
    // 去重并按 UxLy 自然顺序排序，保证相同选择产生相同 source（进度可复用）
    const ids = Array.from(new Set(selection)).sort(compareLessonId);
    return `${SOURCE_PREFIX}${ids.join(',')}`;
}

export function compareLessonId(a: string, b: string): number {
    const ma = /^U(\d+)L(\d+)$/.exec(a);
    const mb = /^U(\d+)L(\d+)$/.exec(b);
    if (!ma || !mb) return a.localeCompare(b);
    const ua = +ma[1], la = +ma[2], ub = +mb[1], lb = +mb[2];
    return ua !== ub ? ua - ub : la - lb;
}

// ---------- 课顺序（群记 U1-10 优先于序记 U11-12，用于跨课去重） ----------
async function orderedLessonIds(sel: ParsedSource): Promise<string[]> {
    if (sel.all) {
        const m = await loadManifest();
        const ids: string[] = [];
        m.parts.forEach(part => part.units.forEach(u => u.lessons.forEach(l => ids.push(l.id))));
        return ids;
    }
    // 以 manifest 顺序为准，过滤出选中的课
    const m = await loadManifest();
    const set = new Set(sel.lessonIds);
    const ids: string[] = [];
    m.parts.forEach(part => part.units.forEach(u => u.lessons.forEach(l => {
        if (set.has(l.id)) ids.push(l.id);
    })));
    // 若 manifest 未覆盖到的异常 id，按解析顺序补在末尾
    sel.lessonIds.forEach(id => { if (!ids.includes(id)) ids.push(id); });
    return ids;
}

/** 合并多课单词并按词形小写去重，保留首次出现（群记优先） */
function dedupeWords(lessons: { id: string; words: BookWord[] }[]): BookWord[] {
    const seen = new Set<string>();
    const out: BookWord[] = [];
    lessons.forEach(({ words }) => {
        words.forEach(bw => {
            const key = bw.w.toLowerCase();
            if (seen.has(key)) return;
            seen.add(key);
            out.push(bw);
        });
    });
    return out;
}

/** 加载某个 source 的完整单词数据（开始测验时用，异步）
 *  includeDer=true 时把每个主词的派生词展开为独立词条，紧跟在其主词之后（全局去重，主词优先） */
export async function collectBookWords(value: string, includeDer = false): Promise<BookWord[]> {
    const sel = parseSource(value);
    if (!sel) return [];
    const ids = await orderedLessonIds(sel);
    const lessons = await Promise.all(
        ids.map(id => loadLesson(id).then(words => ({ id, words })).catch(() => ({ id, words: [] as BookWord[] })))
    );
    const mains = dedupeWords(lessons);
    if (!includeDer) return mains;
    const seen = new Set(mains.map(bw => bw.w.toLowerCase()));
    const out: BookWord[] = [];
    mains.forEach(mw => {
        out.push(mw);
        (mw.der || []).forEach(d => {
            const key = (d.w || '').toLowerCase().trim();
            if (!key || seen.has(key)) return;
            seen.add(key);
            out.push({
                w: d.w,
                ans: [d.w],
                ph: d.ph || '',
                pos: d.pos && d.pos.length ? d.pos : [{ p: '', d: '' }],
                mem: '',
                ex: null,
                real: null,
                der: [],
                g: mw.g,
                gn: mw.gn,
                derivedFrom: mw.w,
            });
        });
    });
    return out;
}

/** 同步取词列表（进度统计用）；index 未加载时返回空数组，加载完成后调用方需刷新 */
export function getSourceWordListSync(value: string, includeDer = false): string[] {
    const sel = parseSource(value);
    if (!sel || !indexResolved) return [];
    const index = indexResolved;
    const ids = sel.all ? Object.keys(index).sort(compareLessonId)
        : sel.lessonIds.filter(id => index[id]);
    const seen = new Set<string>();
    const out: string[] = [];
    ids.forEach(id => {
        (index[id] || []).forEach(w => {
            const key = w.toLowerCase();
            if (!seen.has(key)) { seen.add(key); out.push(w); }
        });
    });
    if (includeDer) {
        if (!derResolved) {
            // 派生词索引尚未就绪：先返回主词列表，同时后台加载，由调用方稍后刷新
            void loadDerIndex();
        } else {
            ids.forEach(id => {
                (derResolved[id] || []).forEach(w => {
                    const key = w.toLowerCase();
                    if (!seen.has(key)) { seen.add(key); out.push(w); }
                });
            });
        }
    }
    return out;
}

export async function ensureIndexLoaded(): Promise<Record<string, string[]>> {
    return loadIndex();
}

// ---------- 转为测验用单词对象 ----------
export function toQuizWord(bw: BookWord): {
    word: string; phonetic: string;
    meanings: { part: string; definition: string }[];
    answers: string[]; bookExtra: BookExtra;
} {
    return {
        word: bw.w,
        phonetic: bw.ph || '',
        meanings: (bw.pos && bw.pos.length ? bw.pos : [{ p: '', d: '' }])
            .map(x => ({ part: x.p || '', definition: x.d || '' })),
        answers: bw.ans && bw.ans.length ? bw.ans : [bw.w],
        bookExtra: {
            mem: bw.mem || '',
            ex: bw.ex || null,
            real: bw.real || null,
            der: bw.der || [],
            gn: bw.gn || '',
            derivedFrom: bw.derivedFrom || '',
        },
    };
}

// ---------- 显示名 ----------
export function getSourceLabel(value: string): string {
    const sel = parseSource(value);
    if (!sel) return '';
    if (sel.all) return `${BOOK_SHORT}·整本`;
    const ids = sel.lessonIds;
    if (ids.length === 1) {
        const m = /^U(\d+)L(\d+)$/.exec(ids[0]);
        if (m) return `${BOOK_SHORT}·U${m[1]} L${m[2]}`;
        return `${BOOK_SHORT}·${ids[0]}`;
    }
    // 同单元多课
    const units = new Set(ids.map(id => (/^U(\d+)L\d+$/.exec(id) || [])[1]).filter(Boolean));
    if (units.size === 1) {
        const u = [...units][0];
        const lessons = ids
            .map(id => (/^U\d+L(\d+)$/.exec(id) || [])[1])
            .filter(Boolean)
            .map(n => `L${n}`)
            .join('、');
        return `${BOOK_SHORT}·U${u}（${lessons}）`;
    }
    return `${BOOK_SHORT}·已选 ${ids.length} 课`;
}
