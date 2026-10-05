// 学习激励：连胜（streak）、每日目标、连胜里程碑、连胜保护卡
// 数据独立于 studyStats，存 localStorage：
//   dailyLog  : { 'YYYY-MM-DD': { words, seconds, goalMet } }
//   streakData: { current, best, freezes, lastActive, milestones[] }
// 纯本地、无服务器。日期一律按电脑本地时区。

import { appState } from '../store';
import { safeParse } from './storage';

const DAILY_KEY = 'dailyLog';
const STREAK_KEY = 'streakData';

export interface DailyEntry { words: number; seconds: number; goalMet: boolean; }
export type DailyLog = Record<string, DailyEntry>;

export interface StreakData {
    current: number;
    best: number;
    freezes: number;
    lastActive: string | null;
    milestones: number[];
}

export interface GamEvent {
    today: DailyEntry;
    streak: StreakData;
    streakAdvanced: boolean;   // 今天首次学习，连胜 +1
    streakFrozen: boolean;     // 自动消耗一张保护卡保住连胜
    streakReset: boolean;      // 断签，连胜归 1
    goalJustMet: boolean;      // 今天刚达成每日目标
    milestone?: number;        // 刚达成的连胜里程碑
    freezeReward?: number;     // 里程碑奖励的保护卡数
}

/** 连胜里程碑（天） */
export const MILESTONES = [3, 7, 30, 100, 365];
/** 各里程碑奖励的连胜保护卡数量 */
const FREEZE_REWARD: Record<number, number> = { 3: 0, 7: 1, 30: 2, 100: 3, 365: 5 };

// 内存缓存（单一数据来源），显式 flush 落盘
let logCache: DailyLog | null = null;
let streakCache: StreakData | null = null;

// ---------------- 日期 ----------------
export function dayKey(d: Date = new Date()): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}
function parseDay(s: string): Date {
    const [y, m, d] = s.split('-').map(Number);
    return new Date(y, m - 1, d);
}
/** 两个 dayKey 之间相差的整天数（b - a） */
function dayDiff(a: string, b: string): number {
    return Math.round((parseDay(b).getTime() - parseDay(a).getTime()) / 86_400_000);
}

// ---------------- 存取 ----------------
function loadLog(): DailyLog {
    if (!logCache) logCache = safeParse<DailyLog>(DAILY_KEY, {});
    return logCache;
}
export function flushDailyLog(): void {
    if (logCache) localStorage.setItem(DAILY_KEY, JSON.stringify(logCache));
}
function loadStreak(): StreakData {
    if (!streakCache) {
        streakCache = safeParse<StreakData>(STREAK_KEY, {
            current: 0, best: 0, freezes: 0, lastActive: null, milestones: [],
        });
        // 兼容字段缺失
        const s = streakCache;
        if (typeof s.current !== 'number') s.current = 0;
        if (typeof s.best !== 'number') s.best = 0;
        if (typeof s.freezes !== 'number') s.freezes = 0;
        if (!Array.isArray(s.milestones)) s.milestones = [];
    }
    return streakCache;
}
function saveStreak(): void {
    if (streakCache) localStorage.setItem(STREAK_KEY, JSON.stringify(streakCache));
}

function emptyEntry(): DailyEntry { return { words: 0, seconds: 0, goalMet: false }; }

// ---------------- 核心记录 ----------------
/**
 * 记录“学会了 count 个词”。每题落库时调用一次。
 * 仅在当天首次学习时推进连胜并判定里程碑。
 */
export function recordWordLearned(count: number = 1): GamEvent {
    const tk = dayKey();
    const log = loadLog();
    const entry: DailyEntry = log[tk] ? { ...log[tk] } : emptyEntry();
    entry.words += count;

    const goal = Math.max(1, Number(appState.settings.dailyWordCount) || 20);
    let goalJustMet = false;
    if (!entry.goalMet && entry.words >= goal) {
        entry.goalMet = true;
        goalJustMet = true;
    }
    log[tk] = entry;
    flushDailyLog();

    const st = loadStreak();
    let streakAdvanced = false, streakFrozen = false, streakReset = false;
    let milestone: number | undefined, freezeReward = 0;

    if (st.lastActive !== tk) {
        if (!st.lastActive) {
            st.current = 1;
            streakAdvanced = true;
        } else {
            const gap = dayDiff(st.lastActive, tk);
            if (gap === 1) {
                st.current += 1;
                streakAdvanced = true;
            } else if (gap === 2 && st.freezes > 0) {
                // 恰好错过 1 天且有保护卡：消耗 1 张，连胜保持
                st.freezes -= 1;
                streakFrozen = true;
            } else {
                st.current = 1;
                streakReset = true;
            }
        }
        if (st.current > st.best) st.best = st.current;
        st.lastActive = tk;

        for (const m of MILESTONES) {
            if (st.current === m && !st.milestones.includes(m)) {
                st.milestones.push(m);
                milestone = m;
                const reward = FREEZE_REWARD[m] || 0;
                if (reward > 0) {
                    st.freezes += reward;
                    freezeReward = reward;
                }
            }
        }
        saveStreak();
    }

    const ev: GamEvent = {
        today: { ...entry },
        streak: { ...st, milestones: [...st.milestones] },
        streakAdvanced,
        streakFrozen,
        streakReset,
        goalJustMet,
    };
    if (milestone !== undefined) ev.milestone = milestone;
    if (freezeReward > 0) ev.freezeReward = freezeReward;
    return ev;
}

/** 累加学习秒数（高频调用，仅改内存，由 timer 定期 flush） */
export function addStudySeconds(s: number = 1): void {
    const tk = dayKey();
    const log = loadLog();
    const entry: DailyEntry = log[tk] ? { ...log[tk] } : emptyEntry();
    entry.seconds += s;
    log[tk] = entry;
}

// ---------------- 查询 ----------------
export function getTodayEntry(): DailyEntry {
    const log = loadLog();
    return log[dayKey()] ? { ...log[dayKey()] } : emptyEntry();
}
export function getStreakData(): StreakData {
    const st = loadStreak();
    return { ...st, milestones: [...st.milestones] };
}
/** 仅供测试：清空模块级缓存，强制下次从 localStorage 重读 */
export function __resetGamCache(): void {
    streakCache = null;
    logCache = null;
}
/** 最近 n 天的每日记录（含补零），按日期升序 */
export function getRecentDailyLog(n: number): { date: string; entry: DailyEntry }[] {
    const log = loadLog();
    const out: { date: string; entry: DailyEntry }[] = [];
    const base = new Date();
    for (let i = n - 1; i >= 0; i--) {
        const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() - i);
        const k = dayKey(d);
        out.push({ date: k, entry: log[k] ? { ...log[k] } : emptyEntry() });
    }
    return out;
}

/** 某年、某月（month 为 0-11）的每日记录（补零、升序）；未来日期截断到今天 */
export function getDailyLogForMonth(year: number, month: number): { date: string; entry: DailyEntry }[] {
    const log = loadLog();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const todayK = dayKey();
    const out: { date: string; entry: DailyEntry }[] = [];
    for (let d = 1; d <= daysInMonth; d++) {
        const k = dayKey(new Date(year, month, d));
        if (k > todayK) break; // 未来日期不渲染
        out.push({ date: k, entry: log[k] ? { ...log[k] } : emptyEntry() });
    }
    return out;
}

/** 最早有学习数据的年月（无记录则为当前月），用于限制月份翻页下界 */
export function getEarliestLogMonth(): { year: number; month: number } {
    const log = loadLog();
    const first = Object.keys(log).sort().find(k => {
        const e = log[k];
        return !!e && (e.words > 0 || e.seconds > 0);
    });
    if (!first) {
        const now = new Date();
        return { year: now.getFullYear(), month: now.getMonth() };
    }
    const [y, m] = first.split('-').map(Number);
    return { year: y, month: m - 1 };
}

// ---------------- 庆祝动画（零依赖 DOM 彩带） ----------------
export function reducedMotion(): boolean {
    return !!window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** 里程碑 / 目标达成时的彩带庆祝，约 3 秒后自动移除 */
export function fireCelebration(): void {
    if (reducedMotion()) return;
    const layer = document.createElement('div');
    layer.className = 'gm-confetti-layer';
    const colors = ['#4da3ff', '#7cd9a3', '#ffd166', '#ff8fa3', '#b79cff'];
    for (let i = 0; i < 64; i++) {
        const c = document.createElement('span');
        c.className = 'gm-confetti';
        c.style.left = Math.random() * 100 + 'vw';
        c.style.background = colors[i % colors.length];
        c.style.animationDelay = (Math.random() * 0.4).toFixed(2) + 's';
        c.style.animationDuration = (1.6 + Math.random() * 1.3).toFixed(2) + 's';
        if (i % 3 === 0) c.style.borderRadius = '50%';
        layer.appendChild(c);
    }
    document.body.appendChild(layer);
    window.setTimeout(() => layer.remove(), 3600);
}
