// 模拟题模块：阅读理解（CET-4 / CET-6 分开）+ 听力理解（仅 CET-4）
// 流程：选择题型/难度 → 选择篇目/套卷 → 作答 → 交卷判分 → 显示翻译/答案/原文 → 四级核心词（可点击查词）
// 数据：public/exams（构建脚本 tools/exam）；听力音频走后端 /api/exam/listening-audio（流式，支持 Range）

import { escapeHtml, switchPage } from '../global';
import { searchWord } from './dictionary';
import { apiGet } from '../utils/api';
import { gradeQuestions } from '../utils/examGrade';
import { PageSection } from '../types/enums';

const BASE_URL = (import.meta.env.BASE_URL || '/').replace(/\/$/, '');
const EXAM_URL = `${BASE_URL}/exams`;
const PAGE_ID = 'exam-page';
const LETTERS = ['A', 'B', 'C', 'D'];

// ---------------- 数据类型（对应构建 JSON 短键） ----------------
interface RQuestion { n: number; s: string; o: string[]; a: string; e: string; zs: string; zo: string[] }
interface RArticle { n: number; t: string; p: string[]; q: RQuestion[]; zt: string; zp: string[] }
interface ReadingFile { level: string; label: string; count: number; articles: RArticle[] }

interface LQuestion { n: number; s: string; o: string[]; a: string }
interface LClip { name: string; questions: LQuestion[] }
interface LSection { key: string; name: string; clips: LClip[] }
interface LTranscriptBlock { heading: string; paras: string[] }
interface ListeningTest {
    id: string; title: string; audio: string;
    sections: LSection[]; transcript: LTranscriptBlock[]; hasWav: boolean;
}
interface ListeningIndexItem { id: string; title: string; hasWav: boolean }
interface ListeningIndex { type: string; label: string; count: number; tests: ListeningIndexItem[] }
interface Keyword { w: string; ph: string; mean: string; count: number }

type View = 'home' | 'reading-list' | 'listening-list' | 'reading' | 'listening';
type ReadingLevel = 'cet4' | 'cet6';

// ---------------- 模块状态 ----------------
let view: View = 'home';
const readingCache: Partial<Record<ReadingLevel, ReadingFile>> = {};
let listeningIndex: ListeningIndex | null = null;
let listeningAvailable: Set<string> | null = null;
const testCache: Record<string, ListeningTest> = {};

let readingLevel: ReadingLevel = 'cet4';
let readingPos = 0;
let listeningPos = 0;
let currentTest: ListeningTest | null = null;

let answers: Record<number, string> = {};
let submitted = false;
let showAnswers = false;
let showTranslation = false;
let showTranscript = false;
let keywords: Keyword[] = [];
let keywordsState: 'idle' | 'loading' | 'done' | 'error' = 'idle';
// 阅读三阶段：1 注释阅读 → 2 作答 → 3 无注释回看
let readingStage: 1 | 2 | 3 = 1;
// 本篇 / 本套靶词（四级核心词）集合，小写；用于正文高亮与注释清洗
let targetWords: Set<string> = new Set();

// ---- 已交卷完成状态（持久化，用于列表序号圆圈标绿） ----
const COMPLETED_KEY = 'examCompleted';
interface ExamRecord { done: true; answers: Record<number, string>; }
type CompletedMap = Record<string, boolean | ExamRecord>;

function loadCompleted(): CompletedMap {
    try { return JSON.parse(localStorage.getItem(COMPLETED_KEY) || '{}') as CompletedMap; }
    catch { return {}; }
}
function isCompleted(key: string): boolean {
    const v = loadCompleted()[key];
    return v === true || (!!v && typeof v === 'object' && (v as ExamRecord).done === true);
}
/** 交卷时保存答案，便于右键“查看上次答题情况” */
function markCompleted(key: string, answers?: Record<number, string>): void {
    const m = loadCompleted();
    if (!isCompleted(key)) {
        m[key] = answers ? { done: true, answers: { ...answers } } : true;
        localStorage.setItem(COMPLETED_KEY, JSON.stringify(m));
    } else if (answers) {
        // 已完成但重做后再次交卷：更新答案
        m[key] = { done: true, answers: { ...answers } };
        localStorage.setItem(COMPLETED_KEY, JSON.stringify(m));
    }
}
/** 读取某篇 / 套上次交卷的答案；无记录返回 null */
function getSavedAnswers(key: string): Record<number, string> | null {
    const v = loadCompleted()[key];
    if (v && typeof v === 'object' && (v as ExamRecord).answers) return { ...(v as ExamRecord).answers };
    return null;
}
function readingDoneKey(level: string, n: number | string): string { return `reading:${level}:${n}`; }
function listeningDoneKey(id: string): string { return `listening:${id}`; }

// ---- 随鼠标移动的查词小提示框 ----
let wordTipEl: HTMLElement | null = null;
function ensureWordTip(): HTMLElement {
    if (!wordTipEl) {
        wordTipEl = document.createElement('div');
        wordTipEl.id = 'ex-word-tip';
        wordTipEl.className = 'ex-word-tip';
        document.body.appendChild(wordTipEl);
    }
    return wordTipEl;
}
function moveWordTip(x: number, y: number): void {
    const tip = ensureWordTip();
    tip.style.opacity = '1';
    let left = x + 14;
    let top = y + 18;
    const w = tip.offsetWidth || 170;
    const h = tip.offsetHeight || 30;
    if (left + w > window.innerWidth - 8) left = x - w - 14;
    if (top + h > window.innerHeight - 8) top = y - h - 14;
    tip.style.left = Math.max(6, left) + 'px';
    tip.style.top = Math.max(6, top) + 'px';
}
function hideWordTip(): void { ensureWordTip().style.opacity = '0'; }

// 听力播放控制：9 档倍速（0.7~1.5，每 0.1 一档）；未交卷时用 audioAllowedTime 锁定进度
const PLAYBACK_RATES = [0.7, 0.8, 0.9, 1.0, 1.1, 1.2, 1.3, 1.4, 1.5];
let audioAllowedTime = 0;

// ---------------- 工具 ----------------
function el(): HTMLElement {
    return document.getElementById(PAGE_ID) as HTMLElement;
}
function esc(s: unknown): string {
    return escapeHtml(s == null ? '' : String(s));
}
// 把英文正文逐词包成“隐藏式”超链接：默认外观与正文一致，hover 高光，点击跳词典；
// 靶词（本篇四级核心词）额外加 ex-target 高亮。
function linkifyEnglish(text: string): string {
    if (!text) return '';
    const parts = text.split(/([A-Za-z][A-Za-z'’\-]*)/g);
    return parts.map(p => {
        if (/^[A-Za-z][A-Za-z'’\-]*$/.test(p)) {
            return wordAnchor(p, targetWords.has(p.toLowerCase()));
        }
        return esc(p);
    }).join('');
}

// ---- 三阶段正文管线 ----
// 括号注释：英文词 + 全角/半角括号内的中文释义
const NOTE_RE = /([A-Za-z][A-Za-z'’\-]*)\s*[（(]([^）)]*)[）)]/g;

/** 把一个英文词包成查词链接；靶词额外加 ex-target 高亮 */
function wordAnchor(word: string, isTarget: boolean): string {
    const w = word.replace(/[’]/g, "'");
    return `<a class="ex-word${isTarget ? ' ex-target' : ''}" data-action="lookup-word" data-word="${esc(w)}">${esc(word)}</a>`;
}

/** 注释是否在某阶段显示：阶段1 全显示；阶段2 仅超纲词（非靶词）显示；阶段3 全隐藏 */
function noteVisible(stage: 1 | 2 | 3, isTarget: boolean): boolean {
    if (stage === 1) return true;
    if (stage === 2) return !isTarget;
    return false;
}

/**
 * 统一正文转换：三阶段注释处理 + 靶词高亮 + 学习中即可悬浮查词。
 * 普通文本走 linkifyEnglish；命中「词+括号注释」的词单独处理高亮与注释显隐。
 */
function processPassage(text: string, stage: 1 | 2 | 3): string {
    if (!text) return '';
    NOTE_RE.lastIndex = 0;
    let out = '';
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = NOTE_RE.exec(text))) {
        out += linkifyEnglish(text.slice(last, m.index));
        const word = m[1];
        const note = m[2];
        const isTarget = targetWords.has(word.toLowerCase());
        out += wordAnchor(word, isTarget);
        if (noteVisible(stage, isTarget)) {
            out += `<span class="ex-inline-note">（${esc(note)}）</span>`;
        }
        last = NOTE_RE.lastIndex;
    }
    out += linkifyEnglish(text.slice(last));
    return out;
}

/** 听力原文转换：保留括号（选项标记 / 说话人 / 舞台说明），靶词高亮 + 查词链接 */
function processTranscript(text: string): string {
    if (!text) return '';
    return text.split(/([A-Za-z][A-Za-z'’\-]*)/g).map(p => {
        if (/^[A-Za-z][A-Za-z'’\-]*$/.test(p)) {
            return wordAnchor(p, targetWords.has(p.toLowerCase()));
        }
        return esc(p);
    }).join('');
}

async function fetchJson<T>(url: string): Promise<T> {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`资源加载失败 (${r.status})`);
    return (await r.json()) as T;
}
function render(html: string): void {
    const box = el();
    if (box) box.innerHTML = html;
    window.scrollTo({ top: 0 });
}
function totalQuestions(): number {
    if (view === 'reading') {
        const f = readingCache[readingLevel];
        return f ? f.articles[readingPos].q.length : 0;
    }
    if (view === 'listening' && currentTest) {
        return currentTest.sections.reduce((n, s) => n + s.clips.reduce((m, c) => m + c.questions.length, 0), 0);
    }
    return 0;
}
function answeredCount(): number {
    return Object.keys(answers).length;
}
function correctCount(): number {
    if (view === 'reading') {
        const qs = readingCache[readingLevel]?.articles[readingPos].q ?? [];
        return gradeQuestions(qs, answers).correct;
    }
    if (currentTest) {
        const qs = currentTest.sections.flatMap(s => s.clips.flatMap(c => c.questions));
        return gradeQuestions(qs, answers).correct;
    }
    return 0;
}
function resetAnswers(): void {
    stopSimTimer();
    answers = {};
    submitted = false;
    showAnswers = false;
    showTranslation = false;
    showTranscript = false;
    keywords = [];
    keywordsState = 'idle';
    readingStage = 1;
    targetWords = new Set();
}
/** 恢复到上次交卷状态（右键“查看上次答题情况”） */
function applyReviewState(saved: Record<number, string>): void {
    resetAnswers();
    answers = { ...saved };
    submitted = true;
    readingStage = 3;
}

// ---------------- 首页 ----------------
function renderHome(): void {
    view = 'home';
    render(`
    <div class="ex-home">
      <h1>模拟题</h1>
      <p class="ex-home-sub">阅读理解按四级、六级分开；听力为四级完整模拟套卷。做题交卷后可查看翻译、答案解析、听力原文与四级核心词。</p>
      <div class="ex-sim glass">
        <label class="ex-sim-toggle">
          <input type="checkbox" id="sim-mode-toggle" ${isSimMode() ? 'checked' : ''}>
          <span><strong>模拟模式</strong> · 限时作答，模拟真实考试节奏</span>
        </label>
        <div class="ex-sim-duration">
          阅读限时
          <input type="number" id="sim-duration" min="5" max="180" step="5" value="${Math.round(simDurationSec() / 60)}">
          分钟（点「开始答题」后倒计时，到点自动交卷）；听力开启后音频播放完立即自动交卷
        </div>
      </div>
      <div class="ex-cards">
        <div class="ex-card glass">
          <div class="ex-card-head">
            <span class="ex-card-icon">🎧</span>
            <div>
              <h2>听力理解</h2>
              <span class="ex-badge ex-badge-cet4">CET-4</span>
            </div>
          </div>
          <p class="ex-card-desc">100 套完整听力模拟（新闻 / 长对话 / 短文，共 25 题），含原声音频、听力原文、答案与核心词。</p>
          <button class="btn ex-primary" data-action="open-listening-list">进入听力题库</button>
        </div>
        <div class="ex-card glass">
          <div class="ex-card-head">
            <span class="ex-card-icon">📖</span>
            <div>
              <h2>阅读理解</h2>
              <span class="ex-badge ex-badge-cet4">CET-4</span>
              <span class="ex-badge ex-badge-cet6">CET-6</span>
            </div>
          </div>
          <p class="ex-card-desc">共 399 篇，已按难度分开：四级 199 篇、六级 200 篇。每篇 5 道选择题，含全文翻译、答案解析与核心词。</p>
          <div class="ex-card-actions">
            <button class="btn ex-primary" data-action="open-reading-list" data-level="cet4">四级阅读 · 199 篇</button>
            <button class="btn ex-secondary" data-action="open-reading-list" data-level="cet6">六级阅读 · 200 篇</button>
          </div>
        </div>
      </div>
    </div>`);
}

function renderError(title: string, detail: string): void {
    render(`
      <div class="ex-error glass">
        <h2>${esc(title)}</h2>
        <p>${esc(detail)}</p>
        <button class="btn ex-secondary" data-action="back-home">返回模拟题首页</button>
      </div>`);
}

// ---------------- 列表 ----------------
async function openReadingList(level: ReadingLevel): Promise<void> {
    view = 'reading-list';
    render('<div class="ex-loading">正在加载阅读题库…</div>');
    try {
        if (!readingCache[level]) {
            readingCache[level] = await fetchJson<ReadingFile>(`${EXAM_URL}/reading/${level}.json`);
        }
        renderReadingList();
    } catch (e) {
        console.error('加载阅读题库失败', e);
        renderError('未找到阅读题库资源', '请确认已运行构建脚本 tools/exam/build_reading.py 生成 public/exams/reading 数据。');
    }
}

function renderReadingList(): void {
    view = 'reading-list';
    const f = readingCache[readingLevel];
    if (!f) return;
    const items = f.articles.map((a, i) => `
      <button class="ex-list-item" data-action="open-reading" data-pos="${i}">
        <span class="ex-list-no${isCompleted(readingDoneKey(readingLevel, a.n)) ? ' ex-list-done' : ''}">${a.n}</span>
        <span class="ex-list-title">${esc(a.t)}</span>
      </button>`).join('');
    render(wrapList(
        f.label, `${f.count} 篇`,
        `<button class="btn ex-primary" data-action="random-reading">随机一篇</button>`,
        'reading-jump', items));
}

async function openListeningList(): Promise<void> {
    view = 'listening-list';
    render('<div class="ex-loading">正在加载听力题库…</div>');
    try {
        if (!listeningIndex) {
            listeningIndex = await fetchJson<ListeningIndex>(`${EXAM_URL}/listening/index.json`);
        }
        // 运行时音频可用状态（构建时的 hasWav 在打包后可能不准）
        if (listeningAvailable === null) {
            try {
                const st = await apiGet<{ data: { ids: string[] } }>('/api/exam/listening-status');
                listeningAvailable = new Set((st && st.data && st.data.ids) || []);
            } catch {
                listeningAvailable = new Set(listeningIndex.tests.filter(t => t.hasWav).map(t => t.id));
            }
        }
        renderListeningList();
    } catch (e) {
        console.error('加载听力题库失败', e);
        renderError('未找到听力题库资源', '请确认已运行构建脚本 tools/exam/build_listening.py 生成 public/exams/listening 数据。');
    }
}

function renderListeningList(): void {
    view = 'listening-list';
    if (!listeningIndex) return;
    const avail = listeningAvailable;
    const items = listeningIndex.tests.map((t, i) => {
        const ok = !avail || avail.has(t.id);
        return `
        <button class="ex-list-item${ok ? '' : ' ex-list-noaudio'}" data-action="open-listening" data-pos="${i}">
          <span class="ex-list-no${isCompleted(listeningDoneKey(t.id)) ? ' ex-list-done' : ''}">${String(i + 1).padStart(3, '0')}</span>
          <span class="ex-list-title">${esc(t.title)}</span>
          <span class="ex-list-tag">${ok ? '含音频' : '无音频'}</span>
        </button>`;
    }).join('');
    const audioCount = avail ? avail.size : listeningIndex.count;
    render(wrapList(
        listeningIndex.label, `${listeningIndex.count} 套 · ${audioCount} 套含音频`,
        `<button class="btn ex-primary" data-action="random-listening">随机一套</button>`,
        'listening-jump', items));
}

function wrapList(title: string, meta: string, randomBtn: string, jumpId: string, items: string): string {
    return `
    <div class="ex-list-page">
      <div class="ex-topbar">
        <button class="btn ex-ghost" data-action="back-home">‹ 返回</button>
        <div class="ex-topbar-title">
          <h1>${esc(title)}</h1>
          <span class="ex-topbar-meta">${esc(meta)}</span>
        </div>
        ${randomBtn}
      </div>
      <div class="ex-jumpbar">
        <label>跳转到第 <input type="number" id="${jumpId}" min="1" class="ex-jump-input"> 篇/套</label>
        <button class="btn ex-secondary" data-action="jump" data-target="${jumpId}">前往</button>
      </div>
      <div class="ex-list-hint">左键点击题目重新做题 · 右键点击题目查看上次答题情况（用于复习）</div>
      <div class="ex-list-grid">${items}</div>
    </div>`;
}

// ---------------- 阅读做题页 ----------------
async function openReading(pos: number, review: boolean = false): Promise<void> {
    let f = readingCache[readingLevel];
    if (!f) { await openReadingList(readingLevel); f = readingCache[readingLevel]; if (!f) return; }
    readingPos = Math.max(0, Math.min(pos, f.articles.length - 1));
    const key = readingDoneKey(readingLevel, f.articles[readingPos].n);
    if (review) {
        const saved = getSavedAnswers(key);
        if (saved) applyReviewState(saved); else resetAnswers();
    } else {
        resetAnswers();
    }
    renderReading();
    void ensureKeywords();
    if (review && submitted) requestAnimationFrame(() => renderExtra());
}

function stageBannerHtml(stage: 1 | 2 | 3): string {
    if (stage === 1) {
        return `<div class="ex-stage-banner">
          <span class="ex-stage-tag">阶段 1 · 注释阅读</span>
          <p>正文已标注生词注释，并高亮本篇四级核心词；可点击任意单词查词。你可以先通读文章，也可直接开始答题。</p>
        </div>`;
    }
    if (stage === 2) {
        return `<div class="ex-stage-banner ex-stage-quiz">
          <span class="ex-stage-tag">阶段 2 · 作答</span>
          <p>核心词注释已隐藏，请根据对文章的理解作答；需要时仍可点击单词查词。</p>
        </div>`;
    }
    return `<div class="ex-stage-banner ex-stage-done">
      <span class="ex-stage-tag">阶段 3 · 无注释回看</span>
      <p>已隐藏全部注释，可对照题目、解析与翻译复习本篇。</p>
    </div>`;
}

function renderReading(): void {
    view = 'reading';
    const f = readingCache[readingLevel];
    if (!f) return;
    const a = f.articles[readingPos];
    const stage = readingStage;
    const passage = `
      <div class="ex-passage glass">
        <h2 class="ex-passage-title">${esc(a.t)}</h2>
        <div class="ex-word-hint">💡 点击任意单词可查看释义；<span class="ex-target-eg">高亮词</span>为本篇四级核心词</div>
        ${stageBannerHtml(stage)}
        ${a.p.map(para => `<p class="ex-passage-p">${processPassage(para, stage)}</p>`).join('')}
        ${stage === 1
            ? '<button type="button" class="btn ex-primary ex-stage-go" data-action="reading-start-quiz">确认选这篇，开始答题</button>'
            : ''}
      </div>`;
    const quizArea = stage === 1
        ? ''
        : `<div class="ex-questions glass">
             <h3>题目（共 ${a.q.length} 题）</h3>
             ${isSimMode() && stage === 2 ? '<div class="ex-sim-bar"><span id="sim-countdown" class="ex-sim-clock">⏱ --:--</span><span class="ex-sim-note">模拟模式 · 到点自动交卷</span></div>' : ''}
             ${a.q.map(q => questionHtml(q)).join('')}
           </div>
           ${submitBarHtml(a.q.length)}`;
    render(`
      <div class="ex-practice" data-kind="reading">
        ${topbarHtml(`${f.label} · 第 ${a.n} 篇`, readingPos > 0, readingPos < f.articles.length - 1)}
        ${passage}
        ${quizArea}
        <div id="ex-result"></div>
      </div>`);
}

// ---------------- 听力做题页 ----------------
async function openListening(pos: number, review: boolean = false): Promise<void> {
    if (!listeningIndex) { await openListeningList(); return; }
    listeningPos = Math.max(0, Math.min(pos, listeningIndex.tests.length - 1));
    const meta = listeningIndex.tests[listeningPos];
    const saved = review ? getSavedAnswers(listeningDoneKey(meta.id)) : null;
    if (!review) resetAnswers();
    render('<div class="ex-loading">正在加载听力题目…</div>');
    try {
        let test = testCache[meta.id];
        if (!test) {
            test = await fetchJson<ListeningTest>(`${EXAM_URL}/listening/tests/${meta.id}.json`);
            testCache[meta.id] = test;
        }
        currentTest = test;
        if (saved) applyReviewState(saved);
        renderListening();
        void ensureKeywords(); // 预加载本套靶词，供听力原文高亮
        if (review && submitted) requestAnimationFrame(() => renderExtra());
    } catch (e) {
        console.error('加载听力套卷失败', e);
        renderError('听力套卷加载失败', '题目资源缺失，请重新运行 tools/exam/build_listening.py。');
    }
}

function renderListening(): void {
    view = 'listening';
    const test = currentTest;
    if (!test) return;
    const total = test.sections.reduce((n, s) => n + s.clips.reduce((m, c) => m + c.questions.length, 0), 0);
    const audioOk = !listeningAvailable || listeningAvailable.has(test.id);
    const sectionsHtml = test.sections.map(sec => `
      <div class="ex-section">
        <h3 class="ex-section-title">Section ${esc(sec.key)} · ${esc(sec.name)}</h3>
        ${sec.clips.map(clip => `
          <div class="ex-clip">
            <div class="ex-clip-name">${esc(clip.name)}</div>
            ${clip.questions.map(q => questionHtml(q)).join('')}
          </div>`).join('')}
      </div>`).join('');

    render(`
      <div class="ex-practice" data-kind="listening">
        ${topbarHtml(test.title, listeningPos > 0, listeningPos < (listeningIndex?.tests.length || 1) - 1)}
        <div class="ex-audio glass">
          ${audioOk
            ? `<audio controls preload="none" src="${esc(test.audio)}"></audio>
               <div class="ex-audio-ctrl">
                 <label class="ex-rate">播放速度
                   <select class="ex-rate-select" aria-label="播放速度">
                     ${PLAYBACK_RATES.map(r => `<option value="${r}" ${r === 1 ? 'selected' : ''}>${r.toFixed(1)}×</option>`).join('')}
                   </select>
                 </label>
                 <p class="ex-audio-hint">音频较大，点击播放后才会加载。${submitted ? '已交卷，可拖动进度条、回退或重复收听。' : '答题阶段只能顺序播放，暂不能拖动或回退进度条，交卷后可自由回听。'}</p>
               </div>`
            : `<div class="ex-audio-missing">
                 <strong>未检测到本套听力音频</strong>
                 <span>音频体积较大未随程序打包。请将 CET4_Listening_Bank 放入 resource/模拟题 目录，或安装听力资源包；下方题目与原文仍可正常练习。</span>
               </div>`}
        </div>
        <div class="ex-questions glass">
          <h3>题目（共 ${total} 题）</h3>
          ${isSimMode() && !submitted ? '<div class="ex-sim-bar"><span class="ex-sim-clock">⏱ 模拟模式</span><span class="ex-sim-note">音频播放结束将自动交卷</span></div>' : ''}
          ${sectionsHtml}
        </div>
        ${submitBarHtml(total)}
        <div id="ex-result"></div>
      </div>`);

    const audio = el().querySelector('audio') as HTMLAudioElement | null;
    if (audio) {
        // 换套 / 重做 / 交卷重渲染后：从头开始、恢复原速
        audioAllowedTime = 0;
        audio.playbackRate = 1.0;
        // 倍速：答题前后均可用
        const rateSel = el().querySelector('.ex-rate-select') as HTMLSelectElement | null;
        rateSel?.addEventListener('change', () => {
            const v = parseFloat(rateSel.value);
            if (Number.isFinite(v)) audio.playbackRate = v;
        });
        // 模拟模式：音频播放完立即自动交卷
        audio.addEventListener('ended', () => {
            if (isSimMode() && !submitted) submit(true);
        });
        if (!submitted) {
            // 答题阶段锁进度：只允许顺序播放，任何前进 / 回退拖动都弹回到已播放到的最大位置
            const onTime = () => {
                if (!submitted && audio.currentTime > audioAllowedTime) {
                    audioAllowedTime = audio.currentTime;
                }
            };
            const onSeeking = () => {
                if (submitted) return;
                if (Math.abs(audio.currentTime - audioAllowedTime) > 0.5) {
                    try { audio.currentTime = Math.max(0, audioAllowedTime); } catch { /* ignore */ }
                }
            };
            audio.addEventListener('timeupdate', onTime);
            audio.addEventListener('seeking', onSeeking);
            // seeked 在跳转真正完成后触发，可拦住“拖到未缓冲位置”时 seeking 阶段 currentTime 尚未更新的漏网
            audio.addEventListener('seeked', onSeeking);
        }
        audio.addEventListener('error', () => {
            const wrap = audio.parentElement;
            if (wrap) {
                wrap.innerHTML = `<div class="ex-audio-missing">
                  <strong>听力音频加载失败</strong>
                  <span>未找到音频资源（resource/模拟题/CET4_Listening_Bank）。题目与原文仍可练习。</span></div>`;
            }
        });
    }
}

// ---------------- 题目 / 顶栏 / 交卷条 ----------------
function topbarHtml(title: string, hasPrev: boolean, hasNext: boolean): string {
    return `
    <div class="ex-topbar">
      <button class="btn ex-ghost" data-action="back-list">‹ 题库列表</button>
      <div class="ex-topbar-title"><h1>${esc(title)}</h1></div>
      <div class="ex-topbar-nav">
        <button class="btn ex-ghost" data-action="prev" ${hasPrev ? '' : 'disabled'}>上一${view === 'reading' ? '篇' : '套'}</button>
        <button class="btn ex-ghost" data-action="next" ${hasNext ? '' : 'disabled'}>下一${view === 'reading' ? '篇' : '套'}</button>
      </div>
    </div>`;
}

function questionHtml(q: { n: number; s: string; o: string[]; a: string }): string {
    const opts = q.o.slice(0, 4).map((text, i) => {
        const letter = LETTERS[i];
        let cls = 'ex-opt';
        if (submitted) {
            if (letter === q.a) cls += ' ex-opt-correct';
            else if (answers[q.n] === letter) cls += ' ex-opt-wrong';
        } else if (answers[q.n] === letter) {
            cls += ' ex-opt-selected';
        }
        return `
          <button type="button" class="${cls}" data-action="pick" data-q="${q.n}" data-opt="${letter}"
            ${submitted ? 'disabled' : ''}>
            <span class="ex-opt-letter">${letter}</span>
            <span class="ex-opt-text">${esc(text)}</span>
          </button>`;
    }).join('');
    let mark = '';
    if (submitted) {
        const ok = answers[q.n] === q.a;
        mark = `<span class="ex-q-mark ${ok ? 'ex-mark-ok' : 'ex-mark-no'}">${ok ? '✓ 正确' : '✗ 错误'}</span>`;
    }
    return `
      <div class="ex-q" data-qn="${q.n}">
        <div class="ex-q-stem"><span class="ex-q-no">${q.n}.</span> ${esc(q.s)} ${mark}</div>
        <div class="ex-opts">${opts}</div>
      </div>`;
}

function submitBarHtml(total: number): string {
    if (submitted) {
        const correct = correctCount();
        const pct = total ? Math.round((correct / total) * 100) : 0;
        const isReading = view === 'reading';
        return `
        <div class="ex-result-bar glass">
          <div class="ex-score">
            <span class="ex-score-num">${correct} / ${total}</span>
            <span class="ex-score-pct">正确率 ${pct}%</span>
          </div>
          <div class="ex-result-toggles">
            <button class="btn ex-secondary" data-action="toggle-answers">${showAnswers ? '隐藏答案与解析' : '显示答案与解析'}</button>
            ${isReading
                ? `<button class="btn ex-secondary" data-action="toggle-translation">${showTranslation ? '隐藏中文翻译' : '显示中文翻译'}</button>`
                : `<button class="btn ex-secondary" data-action="toggle-transcript">${showTranscript ? '隐藏听力原文' : '查看听力原文'}</button>`}
            <button class="btn ex-ghost" data-action="retry">重新做一遍</button>
          </div>
          <div id="ex-extra"></div>
        </div>`;
    }
    const done = answeredCount();
    const allDone = done >= total;
    return `
    <div class="ex-submit-bar glass">
      <span class="ex-progress">已作答 <strong>${done}</strong> / ${total}</span>
      <button class="btn ex-primary" data-action="submit" ${allDone ? '' : 'disabled'}>
        ${allDone ? '交卷并判分' : `还有 ${total - done} 题未作答`}
      </button>
    </div>`;
}

// ---------------- 交卷后的附加区（答案/翻译/原文/核心词） ----------------
function renderExtra(): void {
    const host = document.getElementById('ex-extra');
    if (!host) return;
    const blocks: string[] = [];

    if (showAnswers) blocks.push(answersBlockHtml());

    if (showTranslation && view === 'reading') blocks.push(translationBlockHtml());
    if (showTranscript && view === 'listening' && currentTest) blocks.push(transcriptBlockHtml());

    // 核心词（交卷后加载）
    let kwHtml = '';
    if (keywordsState === 'loading') kwHtml = '<div class="ex-kw-loading">正在提取本篇四级核心词…</div>';
    else if (keywordsState === 'error') kwHtml = '<div class="ex-kw-loading">核心词加载失败，可在交卷后重试。</div>';
    else if (keywordsState === 'done') {
        kwHtml = keywords.length
            ? `<div class="ex-kw-grid">${keywords.map(k => `
                <button class="ex-kw" data-action="lookup" data-word="${esc(k.w)}" title="点击查词">
                  <span class="ex-kw-w">${esc(k.w)}</span>
                  ${k.ph ? `<span class="ex-kw-ph">${esc(k.ph)}</span>` : ''}
                  <span class="ex-kw-mean">${esc(k.mean)}</span>
                </button>`).join('')}</div>`
            : '<div class="ex-kw-loading">本篇未匹配到四级核心词。</div>';
    }
    blocks.push(`
      <div class="ex-keywords">
        <h4>四级核心词<span class="ex-kw-tip">（点击任意词可跳转词典查询）</span></h4>
        ${kwHtml}
      </div>`);

    host.innerHTML = blocks.join('');
}

function answersBlockHtml(): string {
    if (view === 'reading') {
        const a = readingCache[readingLevel]!.articles[readingPos];
        const rows = a.q.map(q => `
          <div class="ex-ans-row">
            <span class="ex-ans-no">${q.n}</span>
            <span class="ex-ans-key">${esc(q.a)}</span>
            <span class="ex-ans-exp">${esc(q.e || '（无解析）')}</span>
          </div>`).join('');
        return `<div class="ex-block"><h4>答案与解析</h4><div class="ex-ans-list">${rows}</div></div>`;
    }
    const test = currentTest!;
    const rows: string[] = [];
    test.sections.forEach(sec => sec.clips.forEach(c => c.questions.forEach(q => {
        rows.push(`<div class="ex-ans-row"><span class="ex-ans-no">${q.n}</span><span class="ex-ans-key">${esc(q.a)}</span></div>`);
    })));
    return `<div class="ex-block"><h4>参考答案</h4><div class="ex-ans-list ex-ans-grid">${rows.join('')}</div></div>`;
}

function translationBlockHtml(): string {
    const a = readingCache[readingLevel]!.articles[readingPos];
    const articleZh = a.zp.length
        ? a.zp.map(p => `<p class="ex-zh-p">${esc(p)}</p>`).join('')
        : '<p class="ex-zh-empty">本篇暂无文章中译。</p>';
    const qZh = a.q.map(q => `
      <div class="ex-zh-q">
        <div class="ex-zh-q-stem">${q.n}. ${esc(q.zs || q.s)}</div>
        ${q.zo.slice(0, 4).map((t, i) => `<div class="ex-zh-opt">${LETTERS[i]}. ${esc(t)}</div>`).join('')}
      </div>`).join('');
    return `
      <div class="ex-block">
        <h4>中文翻译${a.zt ? ` · ${esc(a.zt)}` : ''}</h4>
        <div class="ex-zh-article">${articleZh}</div>
        <h4 class="ex-zh-qtitle">题目翻译</h4>
        ${qZh}
      </div>`;
}

function transcriptBlockHtml(): string {
    const test = currentTest!;
    if (!test.transcript.length) return '<div class="ex-block"><h4>听力原文</h4><p class="ex-zh-empty">本套暂无原文。</p></div>';
    const html = test.transcript.map(b => `
      <div class="ex-tr-block">
        <h5>${esc(b.heading)}</h5>
        ${b.paras.map(p => `<p>${processTranscript(p)}</p>`).join('')}
      </div>`).join('');
    return `<div class="ex-block ex-transcript"><h4>听力原文</h4><div class="ex-word-hint">💡 提示：<span class="ex-target-eg">高亮词</span>为本套四级核心词；点击任意单词可查看它的详细释义</div>${html}</div>`;
}

/**
 * 加载本篇 / 本套核心词并建立靶词集合（targetWords）。
 * 进入做题页即预加载（三阶段高亮 / 清洗都要用）；交卷后复用于附加区。
 */
async function ensureKeywords(): Promise<void> {
    if (keywordsState === 'loading' || keywordsState === 'done') return;
    let url = '';
    if (view === 'reading') {
        const a = readingCache[readingLevel]!.articles[readingPos];
        url = `/api/exam/keywords?type=reading&level=${readingLevel}&n=${a.n}`;
    } else if (view === 'listening' && currentTest) {
        url = `/api/exam/keywords?type=listening&id=${currentTest.id}`;
    } else return;

    keywordsState = 'loading';
    try {
        const res = await apiGet<{ data: { keywords: Keyword[] } }>(url);
        keywords = (res && res.data && res.data.keywords) || [];
        keywordsState = 'done';
        targetWords = new Set(keywords.map(k => (k.w || '').toLowerCase()).filter(Boolean));
    } catch (e) {
        console.error('核心词加载失败', e);
        keywordsState = 'error';
    }

    if (view === 'reading') {
        if (!submitted) renderReading();   // 补正文靶词高亮
        else renderExtra();
    } else if (view === 'listening' && submitted && showTranscript) {
        renderExtra();                     // 听力原文补高亮
    }
}

// ---------------- 交卷 / 重做 ----------------
// ---------------- 模拟模式 ----------------
const SIM_MODE_KEY = 'examSimMode';
const SIM_DURATION_KEY = 'examSimDurationMin';
function isSimMode(): boolean { return localStorage.getItem(SIM_MODE_KEY) === '1'; }
function simDurationSec(): number {
    const m = parseInt(localStorage.getItem(SIM_DURATION_KEY) || '10', 10);
    return (Number.isFinite(m) && m >= 1 ? m : 10) * 60;
}
let simTimer: number | null = null;
let simRemaining = 0;
function stopSimTimer(): void {
    if (simTimer !== null) { clearInterval(simTimer); simTimer = null; }
}
function startSimTimer(totalSec: number): void {
    stopSimTimer();
    simRemaining = Math.max(1, Math.round(totalSec));
    renderSimTimer();
    simTimer = window.setInterval(() => {
        simRemaining--;
        renderSimTimer();
        if (simRemaining <= 0) {
            stopSimTimer();
            if (!submitted) submit(true);
        }
    }, 1000);
}
function renderSimTimer(): void {
    const t = document.getElementById('sim-countdown');
    if (!t) return;
    const m = Math.floor(simRemaining / 60), s = simRemaining % 60;
    t.textContent = `⏱ ${m}:${String(s).padStart(2, '0')}`;
    t.classList.toggle('sim-urgent', simRemaining <= 60);
}

function submit(force: boolean = false): void {
    if (!force && answeredCount() < totalQuestions()) return;
    stopSimTimer();
    submitted = true;
    // 标记本篇 / 本套已完成（列表序号圆圈标绿）
    if (view === 'reading') {
        readingStage = 3; // 交卷后进入「无注释回看」
        markCompleted(readingDoneKey(readingLevel, readingCache[readingLevel]!.articles[readingPos].n), answers);
    } else if (currentTest) {
        markCompleted(listeningDoneKey(currentTest.id), answers);
    }
    // 重渲染整页（题目着对错色 + 交卷条变结果条）
    if (view === 'reading') renderReading();
    else if (view === 'listening') renderListening();
    // 交卷后附加区挂在结果条内
    requestAnimationFrame(() => {
        renderExtra();
        void ensureKeywords(); // 已预加载则直接复用，否则加载后补渲染
        document.querySelector('.ex-result-bar')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
}

function retry(): void {
    resetAnswers();
    if (view === 'reading') renderReading();
    else if (view === 'listening') renderListening();
}

// ---------------- 事件委托 ----------------
function onPick(node: HTMLElement): void {
    if (submitted) return;
    const qn = Number(node.dataset.q);
    const opt = node.dataset.opt || '';
    answers[qn] = opt;
    // 局部更新该题选项样式，避免整页重渲染造成卡顿
    const qBox = el().querySelector(`.ex-q[data-qn="${qn}"]`);
    qBox?.querySelectorAll('.ex-opt').forEach(o => o.classList.remove('ex-opt-selected'));
    node.classList.add('ex-opt-selected');
    // 更新交卷进度
    const total = totalQuestions();
    const done = answeredCount();
    const bar = el().querySelector('.ex-submit-bar');
    if (bar) {
        bar.innerHTML = submitBarHtml(total);
    }
}

async function onClick(e: MouseEvent): Promise<void> {
    const node = (e.target as HTMLElement).closest('[data-action]') as HTMLElement | null;
    if (!node || !el().contains(node)) return;
    const action = node.dataset.action;
    switch (action) {
        case 'open-reading-list':
            readingLevel = (node.dataset.level as ReadingLevel) || 'cet4';
            await openReadingList(readingLevel);
            break;
        case 'open-listening-list':
            await openListeningList();
            break;
        case 'back-home':
            renderHome();
            break;
        case 'back-list':
            if (view === 'reading' || view === 'reading-list') await openReadingList(readingLevel);
            else await openListeningList();
            break;
        case 'open-reading':
            await openReading(Number(node.dataset.pos));
            break;
        case 'open-listening':
            await openListening(Number(node.dataset.pos));
            break;
        case 'random-reading': {
            const f = readingCache[readingLevel];
            if (f) await openReading(Math.floor(Math.random() * f.articles.length));
            break;
        }
        case 'random-listening': {
            if (listeningIndex) await openListening(Math.floor(Math.random() * listeningIndex.tests.length));
            break;
        }
        case 'jump': {
            const input = document.getElementById(node.dataset.target || '') as HTMLInputElement | null;
            const num = parseInt(input?.value || '', 10);
            if (!Number.isFinite(num) || num < 1) break;
            if (view === 'reading-list') {
                const _f = readingCache[readingLevel];
                const _first = _f && _f.articles.length ? _f.articles[0].n : 1;
                await openReading(num - _first);
            }
            else if (view === 'listening-list') await openListening(num - 1);
            break;
        }
        case 'prev':
            if (view === 'reading') await openReading(readingPos - 1);
            else if (view === 'listening') await openListening(listeningPos - 1);
            break;
        case 'next':
            if (view === 'reading') await openReading(readingPos + 1);
            else if (view === 'listening') await openListening(listeningPos + 1);
            break;
        case 'reading-start-quiz':
            readingStage = 2;
            renderReading();
            if (isSimMode()) startSimTimer(simDurationSec());
            requestAnimationFrame(() => {
                document.querySelector('.ex-questions')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            });
            break;
        case 'pick':
            onPick(node);
            break;
        case 'submit':
            submit();
            break;
        case 'retry':
            retry();
            break;
        case 'toggle-answers':
            showAnswers = !showAnswers;
            // 切换按钮文案 + 重渲染附加区
            {
                const btn = el().querySelector('[data-action="toggle-answers"]') as HTMLButtonElement | null;
                if (btn) btn.textContent = showAnswers ? '隐藏答案与解析' : '显示答案与解析';
            }
            renderExtra();
            break;
        case 'toggle-translation':
            showTranslation = !showTranslation;
            {
                const btn = el().querySelector('[data-action="toggle-translation"]') as HTMLButtonElement | null;
                if (btn) btn.textContent = showTranslation ? '隐藏中文翻译' : '显示中文翻译';
            }
            renderExtra();
            break;
        case 'toggle-transcript':
            showTranscript = !showTranscript;
            {
                const btn = el().querySelector('[data-action="toggle-transcript"]') as HTMLButtonElement | null;
                if (btn) btn.textContent = showTranscript ? '隐藏听力原文' : '查看听力原文';
            }
            renderExtra();
            break;
        case 'lookup':
        case 'lookup-word': {
            const w = node.dataset.word || '';
            if (w) {
                await switchPage(PageSection.Dictionary);
                void searchWord(w);
            }
            break;
        }
        default:
            break;
    }
}

// ---------------- 初始化 ----------------
export function initExam(): void {
    const box = el();
    if (!box) return;
    renderHome();
    box.addEventListener('click', (e: MouseEvent) => {
        void onClick(e);
    });
    // 题库列表右键：查看上次答题情况（左键为重新做）
    box.addEventListener('contextmenu', (e: MouseEvent) => {
        const item = (e.target as HTMLElement).closest('.ex-list-item') as HTMLElement | null;
        if (!item || !box.contains(item)) return;
        e.preventDefault();
        const pos = Number(item.dataset.pos);
        if (item.dataset.action === 'open-reading') void openReading(pos, true);
        else if (item.dataset.action === 'open-listening') void openListening(pos, true);
    });
    // 模拟模式设置持久化
    box.addEventListener('change', (e: Event) => {
        const t = e.target as HTMLElement;
        if (t.id === 'sim-mode-toggle') {
            localStorage.setItem(SIM_MODE_KEY, (t as HTMLInputElement).checked ? '1' : '0');
        } else if (t.id === 'sim-duration') {
            const v = parseInt((t as HTMLInputElement).value, 10);
            if (Number.isFinite(v) && v >= 1) localStorage.setItem(SIM_DURATION_KEY, String(v));
        }
    });
    // 隐藏式单词链接：hover 高光 + 随鼠标移动的查词提示框
    box.addEventListener('mousemove', (e: MouseEvent) => {
        const w = (e.target as HTMLElement).closest('.ex-word') as HTMLElement | null;
        if (w && box.contains(w)) {
            const tip = ensureWordTip();
            tip.textContent = `点击查看「${w.dataset.word || ''}」的详细释义`;
            moveWordTip(e.clientX, e.clientY);
        } else {
            hideWordTip();
        }
    });
    box.addEventListener('mouseleave', hideWordTip);
}
