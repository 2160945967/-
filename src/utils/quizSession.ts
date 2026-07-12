// 测验/复习通用 session 管理：开始、提交、中途结束、自然结束、重开、下一轮、状态回退

import { appState } from '../store';
import { updateStudyStats } from '../modules/stats';

export interface QuizWordData {
    word: string;
    phonetic?: string;
    meanings: Array<{ part: string; definition: string }>;
    isSentence?: boolean;
}

export interface SessionState {
    sessionId: string;
    type: 'quiz' | 'review';
    source: string;
    words: QuizWordData[];
    currentIndex: number;
    answeredInThisRound: string[];
    correctCount: number;
    wrongCount: number;
    interrupted: boolean;
    // 回退快照
    errorbookSnapshot: string;
    learningHistorySnapshot: string;
    quizAnsweredWordsSnapshot: string[];
}

const STORAGE_KEY = 'lastSessionState';

export function saveSessionState(state: SessionState): void {
    // 不存 words 完整数据（太大），只存 word 字符串列表，重新加载时再获取释义
    const wordsStr = state.words.map(w => w.word);
    const compact = {
        sessionId: state.sessionId,
        type: state.type,
        source: state.source,
        words: wordsStr,
        currentIndex: state.currentIndex,
        answeredInThisRound: state.answeredInThisRound,
        correctCount: state.correctCount,
        wrongCount: state.wrongCount,
        interrupted: state.interrupted,
        errorbookSnapshot: state.errorbookSnapshot,
        learningHistorySnapshot: state.learningHistorySnapshot,
        quizAnsweredWordsSnapshot: state.quizAnsweredWordsSnapshot,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(compact));
}

export function loadSessionState(): SessionState | null {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return null;
        const compact = JSON.parse(raw);
        return {
            sessionId: compact.sessionId || '',
            type: compact.type,
            source: compact.source,
            words: compact.words.map((w: string) => ({
                word: w,
                phonetic: '',
                meanings: [{ part: '', definition: '' }],
            })),
            currentIndex: compact.currentIndex || 0,
            answeredInThisRound: compact.answeredInThisRound || [],
            correctCount: compact.correctCount || 0,
            wrongCount: compact.wrongCount || 0,
            interrupted: compact.interrupted || false,
            errorbookSnapshot: compact.errorbookSnapshot || '{}',
            learningHistorySnapshot: compact.learningHistorySnapshot || '{}',
            quizAnsweredWordsSnapshot: compact.quizAnsweredWordsSnapshot || [],
        };
    } catch {
        return null;
    }
}

export function clearSessionState(): void {
    localStorage.removeItem(STORAGE_KEY);
}

export function hasSessionState(): boolean {
    return localStorage.getItem(STORAGE_KEY) !== null;
}

export function isSessionInterrupted(): boolean {
    const state = loadSessionState();
    return state !== null && state.interrupted;
}

// 创建快照（开始新 session 时调用）
function takeSnapshots(): { errorbook: string; learningHistory: string; quizAnswered: string[] } {
    return {
        errorbook: JSON.stringify(appState.errorbook || {}),
        learningHistory: localStorage.getItem('learningHistory') || '{}',
        quizAnswered: JSON.parse(localStorage.getItem('quizAnsweredWords') || '[]') as string[],
    };
}

export function createSession(
    type: 'quiz' | 'review',
    source: string,
    words: QuizWordData[],
): SessionState {
    const snapshots = takeSnapshots();
    return {
        sessionId: `${type}_${source}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        type,
        source,
        words: words.slice(), // 复制数组，避免后续修改影响 session
        currentIndex: 0,
        answeredInThisRound: [],
        correctCount: 0,
        wrongCount: 0,
        interrupted: false,
        errorbookSnapshot: snapshots.errorbook,
        learningHistorySnapshot: snapshots.learningHistory,
        quizAnsweredWordsSnapshot: snapshots.quizAnswered,
    };
}

// 标记已答（每题提交后调用）
export function markAnswered(session: SessionState, word: string, isCorrect: boolean): void {
    session.answeredInThisRound.push(word);
    if (isCorrect) {
        session.correctCount++;
    } else {
        session.wrongCount++;
    }
    session.currentIndex++;
}

// 中途结束 - 保存进度
export function endSessionWithSave(session: SessionState): void {
    session.interrupted = true;
    // 更新快照为当前状态，后续继续答题再 rollback 时只回退继续后新增的
    const snapshots = takeSnapshots();
    session.errorbookSnapshot = snapshots.errorbook;
    session.learningHistorySnapshot = snapshots.learningHistory;
    session.quizAnsweredWordsSnapshot = snapshots.quizAnswered;
    saveSessionState(session);
}

// 中途结束 - 回退进度
export function endSessionWithRollback(session: SessionState): void {
    // 回退 quizAnsweredWords
    const snapshotSet = new Set(session.quizAnsweredWordsSnapshot);
    let currentSet = new Set<string>();
    try {
        currentSet = new Set(JSON.parse(localStorage.getItem('quizAnsweredWords') || '[]') as string[]);
    } catch {}

    // 只移除本轮新增的
    const toRemove = session.answeredInThisRound.filter(w => !snapshotSet.has(w));
    toRemove.forEach(w => currentSet.delete(w));
    localStorage.setItem('quizAnsweredWords', JSON.stringify([...currentSet]));

    // 回退 learningHistory
    const snapshotHistory = JSON.parse(session.learningHistorySnapshot) as Record<string, any>;
    const currentHistory = JSON.parse(localStorage.getItem('learningHistory') || '{}') as Record<string, any>;
    toRemove.forEach(w => {
        if (!snapshotHistory[w]) {
            delete currentHistory[w];
        } else {
            currentHistory[w] = snapshotHistory[w];
        }
    });
    localStorage.setItem('learningHistory', JSON.stringify(currentHistory));

    // 回退错题本
    appState.errorbook = JSON.parse(session.errorbookSnapshot);
    localStorage.setItem('errorbook', session.errorbookSnapshot);

    // 左侧学习计数不回退

    // 只清理属于当前 session 的存储，避免误删其他 session
    const stored = loadSessionState();
    if (stored && stored.sessionId === session.sessionId) {
        clearSessionState();
    }
    updateStudyStats();
}

// 自然结束
export function endSessionComplete(session: SessionState): void {
    session.interrupted = false;
    saveSessionState(session);
}

// 设置区按钮显隐
export function updateSettingsButtons(
    type: 'quiz' | 'review',
): void {
    const startBtn = document.getElementById(type === 'quiz' ? 'start-quiz' : 'start-review');
    const continueBtn = document.getElementById(type === 'quiz' ? 'continue-quiz' : 'continue-review');
    const redoBtn = document.getElementById(type === 'quiz' ? 'redo-quiz' : 'redo-review');

    const state = loadSessionState();

    if (startBtn) {
        startBtn.textContent = type === 'quiz' ? '开始新一轮测验' : '开始新一轮复习';
        startBtn.disabled = false;
    }

    if (continueBtn) {
        const show = state !== null && state.interrupted;
        continueBtn.style.display = show ? 'inline-block' : 'none';
    }

    if (redoBtn) {
        const show = state !== null;
        redoBtn.style.display = show ? 'inline-block' : 'none';
    }
}