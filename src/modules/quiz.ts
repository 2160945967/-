// 测验页面：模式选择、题目生成、答案检查（仅测验模式，不使用艾宾浩斯）

import { appState, openModal, showAlert, showConfirm, escapeForJsString, escapeHtml } from '../global';
import { QuizMode, QuizOrder } from '../types/enums';
import { playPronunciation } from '../utils/audio';
import { formatDefinitionHtml } from '../utils/translation';
import { initErrorbookVue } from './errorbook';
import { updateStudyStats } from './stats';
import { loadSettings, saveQuizSettings } from './settings';
import { loadWordbooks, updateWordSourceSelect, getSourceProgress, getSourceWordList, normalizeCaseByType } from './wordbook';
import { setupImeHandling, setupEnterSubmission, setupGlobalShortcuts, setupInputCooldown, getRandomMeanings } from '../utils/quizCommon';
import { updateFavoritesDisplay } from './favorites';
import { animateCorrectFeedback, animateErrorShake, showToast } from '../utils/gsap';
import { apiTranslate } from '../utils/api';
import { selectMeaningsForQuestion, buildMeaningDisplayHtml, checkQuizAnswer } from '../utils/quizHelper';
import {
    SessionState,
    createSession,
    markAnswered,
    endSessionWithSave,
    endSessionWithRollback,
    endSessionComplete,
    clearSessionState,
    loadSessionState,
    saveSessionState,
    updateSettingsButtons,
} from '../utils/quizSession';

interface QuizWordData {
    word: string;
    phonetic?: string;
    meanings: Array<{ part: string; definition: string }>;
    isSentence?: boolean;
}

export function initQuiz(): void {
    loadSettings();

    const startQuizBtn = document.getElementById('start-quiz');
    const showAnswerBtn = document.getElementById('show-answer');
    const nextQuestionBtn = document.getElementById('next-question');
    const quizAnswerInput = document.getElementById('quiz-answer') as HTMLInputElement;

    // 中文输入法处理
    const imeState = setupImeHandling(quizAnswerInput);

    // 测验设置变化时自动保存
    const quizModeSelect = document.getElementById('quiz-mode') as HTMLSelectElement;
    const wordSourceSelect = document.getElementById('word-source') as HTMLSelectElement;
    const quizCountInput = document.getElementById('quiz-count') as HTMLInputElement;
    const quizOrderSelect = document.getElementById('quiz-order') as HTMLSelectElement;

    if (quizModeSelect) {
        quizModeSelect.addEventListener('change', function() {
            saveQuizSettings();
            // 同时更新输入框的placeholder
            const quizAnswerInput = document.getElementById('quiz-answer') as HTMLInputElement;
            if (quizAnswerInput) {
                if (quizModeSelect.value === QuizMode.EnToZh) {
                    quizAnswerInput.placeholder = '请输入答案，输入多个中文时用逗号分号或空格隔开，按Enter提交';
                } else if (quizModeSelect.value === QuizMode.Spelling) {
                    quizAnswerInput.placeholder = '请根据释义拼写单词，按Enter提交';
                } else if (quizModeSelect.value === QuizMode.ListeningStuck) {
                    quizAnswerInput.placeholder = '请听发音并写出听到的单词或句子，按Enter提交';
                } else {
                    quizAnswerInput.placeholder = '请输入答案...按Enter提交';
                }
            }
        });
    }
    if (wordSourceSelect) {
        wordSourceSelect.addEventListener('change', function() {
            saveQuizSettings();
            updateRestartWordbookButton();
        });
    }
    if (quizCountInput) {
        quizCountInput.addEventListener('input', saveQuizSettings);
    }
    if (quizOrderSelect) {
        quizOrderSelect.addEventListener('change', saveQuizSettings);
    }

    if (startQuizBtn) {
        startQuizBtn.addEventListener('click', function() {
            startQuiz();
        });
    }

    // 继续上一轮答题
    const continueQuizBtn = document.getElementById('continue-quiz');
    if (continueQuizBtn) {
        continueQuizBtn.addEventListener('click', () => continueQuiz());
    }

    // 重新开始上一轮答题
    const redoQuizBtn = document.getElementById('redo-quiz');
    if (redoQuizBtn) {
        redoQuizBtn.addEventListener('click', () => redoQuiz());
    }

    // 重新测验整个单词本（设置区入口）
    const restartWordbookBtn = document.getElementById('restart-wordbook');
    if (restartWordbookBtn) {
        restartWordbookBtn.addEventListener('click', () => {
            showConfirm('重新测验该单词本将会清除已练习和未练习的数据，是否继续？', '重新测验确认').then(ok => {
                if (ok) void restartWordbookFromSettings();
            });
        });
    }

    // 结束测验
    const endQuizBtn = document.getElementById('end-quiz');
    if (endQuizBtn) {
        endQuizBtn.addEventListener('click', () => endQuiz());
    }

    if (showAnswerBtn) {
        showAnswerBtn.addEventListener('click', function() {
            showAnswer(true);
        });
    }

    // 测验时加入收藏按钮
    const quizFavBtn = document.getElementById('quiz-fav-btn') as HTMLButtonElement | null;
    if (quizFavBtn) {
        quizFavBtn.addEventListener('click', function() {
            const word = appState.currentQuizWord?.word;
            if (!word) return;
            const isInFavorites = appState.favorites.some((item: { word: string }) => item.word === word);
            if (isInFavorites) {
                void showAlert('该单词已在收藏中');
                return;
            }
            appState.favorites.push({ word, phonetic: appState.currentQuizWord.phonetic || '', meanings: appState.currentQuizWord.meanings || [] });
            updateFavoritesDisplay();
            updateStudyStats();
            quizFavBtn.textContent = '已收藏';
            quizFavBtn.disabled = true;
        });
    }

    // 下一题
    if (nextQuestionBtn) {
        nextQuestionBtn.addEventListener('click', function() {
            nextQuestion();
        });
    }

    // 防抖函数，防止重复触发
    let checkAnswerTimeout: ReturnType<typeof setTimeout> | null = null;
    function debouncedCheckAnswer() {
        if (checkAnswerTimeout) {
            return;
        }
        checkAnswerTimeout = setTimeout(() => {
            checkAnswerTimeout = null;
        }, 500);
        checkAnswer();
    }

    // 答案输入框事件处理
    if (quizAnswerInput) {
        // Enter 提交
        setupEnterSubmission(quizAnswerInput, imeState, () => {
            if (appState.isProcessingAnswer) return;
            if (appState.isWaitingForNextQuestion) {
                appState.isWaitingForNextQuestion = false;
                nextQuestion();
                return;
            }
            const feedback = document.getElementById('quiz-feedback') as HTMLElement;
            if (feedback.classList.contains('quiz-feedback-success')) return;
            debouncedCheckAnswer();
        });

        // 输入冷却期
        setupInputCooldown(quizAnswerInput);

        // 拼写模式：逐字符即时反馈
        quizAnswerInput.addEventListener('input', function() {
            if (appState.currentQuizMode === QuizMode.Spelling) {
                updateSpellingFeedback();
            }
        });

        // 兜底：点击输入框时强制聚焦
        quizAnswerInput.addEventListener('click', function() {
            if (!quizAnswerInput.disabled) {
                quizAnswerInput.focus();
            }
        });
    }

    // Esc 全局快捷键：结束测验（答题区可见时生效）
    document.addEventListener('keydown', function(e: KeyboardEvent) {
        if (e.key !== 'Escape') return;
        const answerArea = document.getElementById('quiz-answer-area');
        const resultEl = document.getElementById('quiz-result');
        // 结果界面有自己的 Esc 处理，不重复
        if (resultEl && resultEl.style.display !== 'none') return;
        if (!answerArea || answerArea.style.display === 'none') return;
        // 设置区输入框不拦截
        if (document.activeElement && document.activeElement.closest('#quiz-settings-area')) return;
        e.preventDefault();
        e.stopPropagation();
        endQuiz();
    });

    updateRestartWordbookButton();
    updateSettingsButtons('quiz');
}

export async function nextQuestion(): Promise<void> {
    await generateQuestion();
}

interface WordMeaning {
    part: string;
    definition: string;
}

// 从释义中随机选择释义（使用公共模块）
export { getRandomMeanings } from '../utils/quizCommon';

// 记录学习历史（用于艾宾浩斯遗忘曲线）
export function recordLearningHistory(word: string, isCorrect: boolean): void {
    let learningHistory = JSON.parse(localStorage.getItem('learningHistory') || '{}');

    // 记录当前时间
    const now = new Date().getTime();

    // 如果单词不存在，初始化记录
    if (!learningHistory[word]) {
        learningHistory[word] = {
            lastStudyTime: now,
            correctCount: 0,
            errorCount: 0,
            nextReviewTime: now // 首次学习后立即复习
        };
    }

    learningHistory[word].lastStudyTime = now;
    if (isCorrect) {
        learningHistory[word].correctCount++;
    } else {
        learningHistory[word].errorCount++;
    }

    // 计算下一次复习时间（基于艾宾浩斯遗忘曲线）
    // 时间间隔：1天、2天、4天、7天、15天、30天、60天、90天
    const intervals = [24*60*60*1000, 48*60*60*1000, 96*60*60*1000, 168*60*60*1000, 360*60*60*1000, 720*60*60*1000, 1440*60*60*1000, 2160*60*60*1000];

    // 基于正确次数选择间隔
    let intervalIndex = Math.min(learningHistory[word].correctCount, intervals.length - 1);
    learningHistory[word].nextReviewTime = now + intervals[intervalIndex];

    localStorage.setItem('learningHistory', JSON.stringify(learningHistory));
}

export function calculateEbbinghausWeight(word: string): number {
    let learningHistory = JSON.parse(localStorage.getItem('learningHistory') || '{}');

    // 如果单词没有学习历史，权重为1（最高）
    if (!learningHistory[word]) {
        return 1.0;
    }

    const now = new Date().getTime();
    const nextReviewTime = learningHistory[word].nextReviewTime;

    // 如果已经超过复习时间，权重增加
    if (now >= nextReviewTime) {
        // 超过时间越多，权重越高
        const overdueTime = now - nextReviewTime;
        const maxOverdue = 30*24*60*60*1000; // 30天
        const overdueRatio = Math.min(overdueTime / maxOverdue, 1);
        return 0.5 + (0.5 * overdueRatio); // 0.5-1.0
    } else {
        // 距离复习时间越远，权重越低
        const timeUntilReview = nextReviewTime - now;
        const maxTime = 90*24*60*60*1000; // 90天
        const timeRatio = Math.min(timeUntilReview / maxTime, 1);
        return 0.1 + (0.4 * (1 - timeRatio)); // 0.1-0.5
    }
}

// 根据艾宾浩斯权重排序单词
export function sortWordsByEbbinghaus(words: QuizWordData[]): QuizWordData[] {
    // 为每个单词计算权重
    const wordsWithWeight = words.map(word => ({
        word: word,
        weight: calculateEbbinghausWeight(word.word)
    }));

    // 按权重排序（权重高的在前）
    wordsWithWeight.sort((a, b) => b.weight - a.weight);

    // 提取排序后的单词
    return wordsWithWeight.map(item => item.word);
}

function formatDayKey(timestamp: number): string {
    const d = new Date(timestamp);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

function formatDayLabel(dayKey: string): string {
    const today = formatDayKey(Date.now());
    const yesterday = formatDayKey(Date.now() - 24 * 60 * 60 * 1000);
    if (dayKey === today) return '今天 (' + dayKey + ')';
    if (dayKey === yesterday) return '昨天 (' + dayKey + ')';
    return dayKey;
}

function buildWordHtml(word: string, timestamp: number, showRemove: boolean = false): string {
    const timeStr = new Date(timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    const removeBtn = showRemove
        ? `<button class="wordlist-btn remove-btn" onclick="event.stopPropagation(); g('removeDueWord', '${escapeForJsString(word)}')">移除</button>`
        : '';
    const words = word.trim().split(/\s+/);
    let type = 'word';
    let typeLabel = '单词';
    let hintText = '点击单词查看完整释义';
    if (words.length > 5 || /[.!?;]/.test(word)) {
        type = 'sentence';
        typeLabel = '句子';
        hintText = '点击句子查看完整释义';
    } else if (words.length > 1) {
        type = 'phrase';
        typeLabel = '词组';
        hintText = '点击词组查看完整释义';
    }
    const displayWord = normalizeCaseByType(word);
    return `
        <div class="wordlist-item">
            <div class="wordlist-word quiz-word-row">
                <span class="type-badge ${type}">${typeLabel}</span>
                <a href="#" onclick="g('navigateToWord', '${escapeForJsString(word)}'); return false;" class="quiz-word-link">${escapeHtml(displayWord)}</a>
                <span class="quiz-word-hint">${hintText}</span>
                <span class="quiz-word-time">${timeStr}</span>
            </div>
            <div class="wordlist-actions">
                <button class="wordlist-btn" onclick="g('playPronunciation', 'us', '${escapeForJsString(word)}')">美式发音</button>
                <button class="wordlist-btn" onclick="g('playPronunciation', 'uk', '${escapeForJsString(word)}')">英式发音</button>
                ${removeBtn}
            </div>
        </div>
    `;
}

// 显示历史练习记录：按天分组
export function showLearningHistory(): void {
    const historyItems = document.getElementById('history-items');
    const historyEmpty = document.getElementById('history-empty');
    const historyCount = document.getElementById('history-collapse-count');

    if (!historyItems || !historyEmpty) {
        return;
    }

    let learningHistory = JSON.parse(localStorage.getItem('learningHistory') || '{}');
    const historyArray = Object.entries(learningHistory).map(([word, data]: [string, any]) => ({
        word: word,
        data: data
    }));

    if (historyArray.length === 0) {
        if (historyCount) historyCount.textContent = '';
        historyItems.innerHTML = '';
        historyEmpty.style.display = 'block';
        return;
    }
    historyEmpty.style.display = 'none';

    const searchInput = document.getElementById('history-search') as HTMLInputElement;
    const searchKeyword = searchInput ? searchInput.value.toLowerCase().trim() : '';
    const filtered = searchKeyword
        ? historyArray.filter(it => it.word.toLowerCase().includes(searchKeyword))
        : historyArray;

    if (filtered.length === 0) {
        historyItems.innerHTML = '';
        historyEmpty.style.display = 'block';
        return;
    }

    if (historyCount) historyCount.textContent = ` (${filtered.length})`;

    // 按天分组
    const dayGroups = new Map<string, Array<{ word: string; data: { lastStudyTime: number; studyCount: number; totalCorrect: number; totalWrong: number; nextReviewTime: number } }>>();
    filtered.forEach(item => {
        const dayKey = formatDayKey(item.data.lastStudyTime);
        if (!dayGroups.has(dayKey)) dayGroups.set(dayKey, []);
        dayGroups.get(dayKey)!.push(item);
    });

    // 按时间倒序排列每个组内的条目
    dayGroups.forEach(items => items.sort((a, b) => b.data.lastStudyTime - a.data.lastStudyTime));

    // 按日期倒序（最新的在前）
    const sortedDayKeys = [...dayGroups.keys()].sort((a, b) => b.localeCompare(a));

    // 构建 HTML
    historyItems.innerHTML = sortedDayKeys.map(dayKey => {
        const words = dayGroups.get(dayKey)!;
        const wordsHtml = words.map(w => buildWordHtml(w.word, w.data.lastStudyTime)).join('');
        const dayLabel = formatDayLabel(dayKey);

        return `
            <div class="history-day-group">
                <div class="history-day-header" onclick="g('toggleHistoryDay', this)">
                    <span class="history-collapse-arrow history-day-arrow">▼</span>
                    <span class="history-day-date">${dayLabel}</span>
                    <span class="history-day-count">${words.length} 个词</span>
                </div>
                <div class="history-day-body">
                    ${wordsHtml}
                </div>
            </div>
        `;
    }).join('');
}

// 查看艾宾浩斯到期词（供复习模式页面使用）
export function showDueWords(): void {
    const history = JSON.parse(localStorage.getItem('learningHistory') || '{}');
    const now = Date.now();
    const dueWordsHtml = document.getElementById('due-words');
    const dueEmpty = document.getElementById('due-words-empty');
    const dueCount = document.getElementById('due-words-count');

    if (!dueWordsHtml || !dueEmpty) return;

    const due = Object.entries(history)
        .filter(([, data]: [string, any]) => data.nextReviewTime && data.nextReviewTime <= now)
        .map(([word, data]: [string, any]) => ({ word, data }))
        .sort((a, b) => a.data.nextReviewTime - b.data.nextReviewTime);

    if (due.length === 0) {
        dueWordsHtml.innerHTML = '';
        dueEmpty.style.display = 'block';
        if (dueCount) dueCount.textContent = '';
        return;
    }
    dueEmpty.style.display = 'none';
    if (dueCount) dueCount.textContent = ` (${due.length})`;

    dueWordsHtml.innerHTML = due.map(item => buildWordHtml(item.word, item.data.nextReviewTime, true)).join('');
}

// 从艾宾浩斯到期词中移除（删除该单词的学习历史）
export function removeDueWord(word: string): void {
    const history = JSON.parse(localStorage.getItem('learningHistory') || '{}');
    if (history[word]) {
        delete history[word];
        localStorage.setItem('learningHistory', JSON.stringify(history));
    }
    showDueWords();
}

export function toggleHistoryDay(el: HTMLElement): void {
    if (!el) return;
    const body = el.nextElementSibling as HTMLElement | null;
    const arrow = el.querySelector('.history-day-arrow') as HTMLElement | null;
    if (!body) return;

    const isOpen = body.style.display !== 'none';
    if (isOpen) {
        body.style.display = 'none';
        if (arrow) arrow.textContent = '▶';
    } else {
        body.style.display = 'block';
        if (arrow) arrow.textContent = '▼';
    }
}

export function toggleDueWords(el: HTMLElement): void {
    if (!el) return;
    const body = el.nextElementSibling as HTMLElement | null;
    const arrow = el.querySelector('.history-day-arrow') as HTMLElement | null;
    if (!body) return;

    const isOpen = body.style.display !== 'none';
    if (isOpen) {
        body.style.display = 'none';
        if (arrow) arrow.textContent = '▶';
    } else {
        body.style.display = 'block';
        if (arrow) arrow.textContent = '▼';
        showDueWords();
    }
}

export function toggleHistoryPanel(el: HTMLElement): void {
    if (!el) return;
    const body = document.getElementById('history-collapse-body');
    const arrow = document.getElementById('history-collapse-arrow');
    if (!body) return;

    const isOpen = body.style.display !== 'none';
    if (isOpen) {
        body.style.display = 'none';
        if (arrow) {
            arrow.textContent = '▶';
            arrow.classList.remove('expanded');
        }
    } else {
        body.style.display = 'block';
        if (arrow) {
            arrow.textContent = '▼';
            arrow.classList.add('expanded');
        }
        showLearningHistory();
    }
}

export function showDueWordsCondition(): void {
    const modal = document.getElementById('due-words-condition-modal');
    if (modal) {
        openModal(modal);
    }
}

// 测验进度追踪
let quizTotalCount = 0;
let quizAnsweredCount = 0;
let quizAnsweredWords: Set<string> = new Set();
let quizAnswerSubmitted = false; // 标记用户是否提交了答案（区别于手动点"显示答案"）
let quizLastAnswerCorrect = false; // 上一题答对还是答错
let _showAnswerEnterHandler: ((e: KeyboardEvent) => void) | null = null;
let quizSession: SessionState | null = null;
let spellingAutoSubmitTimer: ReturnType<typeof setTimeout> | null = null;
let currentRoundStuckWords: string[] = []; // 本轮听力卡壳词

// 区域显隐
function showQuizAnswerArea(): void {
    const settings = document.getElementById('quiz-settings-area');
    const answer = document.getElementById('quiz-answer-area');
    if (settings) settings.style.display = 'none';
    if (answer) answer.style.display = 'block';
}

function showQuizSettingsArea(): void {
    const settings = document.getElementById('quiz-settings-area');
    const answer = document.getElementById('quiz-answer-area');
    const result = document.getElementById('quiz-result');
    if (settings) settings.style.display = 'block';
    if (answer) answer.style.display = 'none';
    updateSpellingFeedback();
    if (result) {
        result.style.display = 'none';
        const handler = (result as any)._keyHandler;
        if (handler) {
            document.removeEventListener('keydown', handler);
            (result as any)._keyHandler = null;
        }
    }
    updateSettingsButtons('quiz');
}

// 清理 showAnswer 注册的 Enter 监听器（切出测验页时调用）
export function cleanupShowAnswerEnterHandler(): void {
    if (_showAnswerEnterHandler) {
        document.removeEventListener('keyup', _showAnswerEnterHandler);
        _showAnswerEnterHandler = null;
    }
}

function saveAnsweredWords(): void {
    localStorage.setItem('quizAnsweredWords', JSON.stringify([...quizAnsweredWords]));
}
function loadAnsweredWords(): void {
    try {
        const saved = JSON.parse(localStorage.getItem('quizAnsweredWords') || '[]');
        quizAnsweredWords = new Set(saved);
    } catch (e) { console.error('解析已答单词列表失败:', e); quizAnsweredWords = new Set(); }
}

const LOOP_COUNTS_KEY = 'quizLoopCounts';

function getLoopCount(source: string): number {
    try {
        const counts = JSON.parse(localStorage.getItem(LOOP_COUNTS_KEY) || '{}');
        return counts[source] || 0;
    } catch { return 0; }
}

function setLoopCount(source: string, count: number): void {
    try {
        const counts = JSON.parse(localStorage.getItem(LOOP_COUNTS_KEY) || '{}');
        counts[source] = count;
        localStorage.setItem(LOOP_COUNTS_KEY, JSON.stringify(counts));
    } catch {}
}

function incrementLoopCount(source: string): void {
    setLoopCount(source, getLoopCount(source) + 1);
}

function clearSourceProgress(source: string): void {
    const words = getSourceWordList(source);
    if (words.length === 0) return;
    const sourceWords = new Set(words);
    try {
        const answered = JSON.parse(localStorage.getItem('quizAnsweredWords') || '[]') as string[];
        const filtered = answered.filter(w => !sourceWords.has(w));
        localStorage.setItem('quizAnsweredWords', JSON.stringify(filtered));
        loadAnsweredWords();
    } catch {}
}

// 根据当前单词来源切换「重新测验该单词本」按钮显示
function updateRestartWordbookButton(): void {
    const wordSourceEl = document.getElementById('word-source') as HTMLSelectElement | null;
    const restartBtn = document.getElementById('restart-wordbook');
    if (!wordSourceEl || !restartBtn) return;
    const source = wordSourceEl.value;
    const isWordbook = source.startsWith('wordbook:') || source.startsWith('system:');
    restartBtn.style.display = isWordbook ? 'inline-block' : 'none';
}

export async function startQuiz(): Promise<void> {
    const quizModeEl = document.getElementById('quiz-mode') as HTMLSelectElement;
    const wordSourceEl = document.getElementById('word-source') as HTMLSelectElement;
    const quizOrderEl = document.getElementById('quiz-order') as HTMLSelectElement;
    const quizCountEl = document.getElementById('quiz-count') as HTMLInputElement;
    if (!quizModeEl || !wordSourceEl || !quizOrderEl || !quizCountEl) return;
    const quizMode = quizModeEl.value;
    const wordSource = wordSourceEl.value;
    const quizOrder = quizOrderEl.value;
    const quizCount = parseInt(quizCountEl.value) || 10;

    // 确保单词本数据已加载
    await loadWordbooks();

    // 重新加载设置，确保使用最新的设置
    loadSettings();

    appState.currentQuizMode = quizMode as QuizMode;
    appState.errorCount = 0;
    currentRoundStuckWords = [];

    // 根据单词来源选择单词
    if (wordSource === 'favorites') {
        appState.quizWords.length = 0;
        const favWords = [...appState.favorites];
        favWords.forEach(wordStr => {
            const converted = convertWordStrToObj(wordStr as any);
            appState.quizWords.push(converted);
        });
    } else if (wordSource === 'errorbook') {
        // 从错题本中选择单词
        const errorWords = Object.keys(appState.errorbook);
        appState.quizWords.length = 0;
        errorWords.forEach(word => {
            appState.quizWords.push({
                word: word,
                phonetic: '',
                meanings: [{ part: '', definition: '' }]
            });
        });
    } else if (wordSource.startsWith('wordbook:')) {
        const wordbookName = wordSource.replace('wordbook:', '');
        if (appState.wordbooks[wordbookName]) {
            appState.quizWords.length = 0;
            appState.wordbooks[wordbookName].forEach(wordStr => {
                const converted = convertWordStrToObj(wordStr as any);
                appState.quizWords.push(converted);
            });
        } else {
            void showAlert('单词本不存在！');
            return;
        }
    } else if (wordSource.startsWith('system:')) {
        const tag = wordSource.replace('system:', '');
        try {
            const response = await fetch('/api/system-wordbook/words?tag=' + tag + '&limit=10000');
            const data = await response.json();
            if (data.success && data.data && data.data.words) {
                appState.quizWords.length = 0;
                data.data.words.forEach((w: { word: string; phonetic?: string; translation?: string }) => {
                    appState.quizWords.push({
                        word: w.word,
                        phonetic: w.phonetic || '',
                        meanings: [{ part: '', definition: w.translation || '' }]
                    });
                });
                // 缓存系统词库单词列表，供统计使用
                try {
                    const cache = JSON.parse(localStorage.getItem('systemWordbookWordsCache') || '{}');
                    cache[tag] = data.data.words.map((w: { word: string }) => w.word);
                    localStorage.setItem('systemWordbookWordsCache', JSON.stringify(cache));
                } catch {}
            } else {
                void showAlert('系统单词本加载失败！');
                return;
            }
        } catch (e: unknown) {
            console.error('加载系统单词本失败:', e);
            void showAlert('加载系统单词本失败');
            return;
        }
    } else {
        appState.quizWords.length = 0;
    }

    loadAnsweredWords();
    quizAnsweredCount = 0;

    // 先过滤已答过的词
    appState.quizWords = appState.quizWords.filter(w => !quizAnsweredWords.has(w.word));

    // 根据选择的模式排序单词
    if (quizOrder === QuizOrder.Random) {
        // 纯随机排序（Fisher-Yates shuffle）
        for (let i = appState.quizWords.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [appState.quizWords[i], appState.quizWords[j]] = [appState.quizWords[j], appState.quizWords[i]];
        }
    }
    // 顺序模式不需要排序，保持原始顺序

    // 开启艾宾浩斯后按复习权重排序（权重高的在前）
    if (appState.settings.enableEbbinghaus) {
        appState.quizWords = sortWordsByEbbinghaus(appState.quizWords);
    }

    // 限制测验个数
    if (appState.quizWords.length > quizCount) {
        appState.quizWords = appState.quizWords.slice(0, quizCount);
    }
    quizTotalCount = appState.quizWords.length;

    if (appState.quizWords.length === 0) {
        // 该来源有单词但全部已练习：展示全部完成界面
        const sourceProgress = getSourceProgress(wordSource);
        if (sourceProgress.total > 0 && sourceProgress.remaining === 0) {
            quizSession = createSession('quiz', wordSource, []);
            saveSessionState(quizSession);
            showQuizResult();
        } else {
            void showAlert('没有可用的单词，请先添加单词到单词本或收藏。');
        }
        return;
    }
    // 过滤后数量不足：提示用户实际可用数量
    if (appState.quizWords.length < quizCount) {
        showToast(`仅剩 ${appState.quizWords.length} 个未测单词，已全部加入测验`);
    }

    // 先显示测验容器，再异步加载释义（避免用户看到空白等待）
    const quizContainer = document.getElementById('quiz-container');
    if (quizContainer) quizContainer.classList.add('quiz-container-visible');
    const quizQuestion = document.getElementById('quiz-question');
    if (quizQuestion) quizQuestion.innerHTML = '<p class="quiz-loading-text">正在加载单词释义...</p>';

    // 创建 session
    quizSession = createSession('quiz', wordSource, appState.quizWords);
    saveSessionState(quizSession);
    showQuizAnswerArea();

    // 批量加载所有单词的释义（避免逐个调用API）
    const wordsToLoad = appState.quizWords.filter(w => {
        const hasMeaning = w.meanings && w.meanings.length > 0 && w.meanings[0].definition;
        return !hasMeaning && !w.isSentence;
    }).map(w => w.word);

    if (wordsToLoad.length > 0) {
        try {
            const response = await fetch('/api/words/batch', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ words: wordsToLoad })
            });
            const result = await response.json();

            if (result.success && result.data) {
                result.data.forEach((item: { word: string; info?: { meanings?: Array<{ part: string; definition: string }>; translation?: string; phonetic?: string } }) => {
                    const wordObj = appState.quizWords.find(w => w.word.toLowerCase() === item.word.toLowerCase());
                    if (wordObj && item.info) {
                        if (item.info.meanings) {
                            wordObj.meanings = item.info.meanings;
                        } else if (item.info.translation) {
                            wordObj.meanings = [{ part: '', definition: item.info.translation }];
                        }
                        if (item.info.phonetic) {
                            wordObj.phonetic = item.info.phonetic;
                        }
                    }
                });
            }
        } catch (e: unknown) {
            console.error('批量加载释义失败:', e);
        }
    }

    await generateQuestion();
}

function convertWordStrToObj(wordStr: string | QuizWordData): QuizWordData {
    if (typeof wordStr === 'string') {
        // 如果是带空格的（词组/句子），直接创建基本对象，不要去匹配单个单词！
        let wordData;
        if (wordStr.includes(' ')) {
            wordData = {
                word: wordStr,
                phonetic: '',
                meanings: [{ part: '', definition: '' }],
                isSentence: true
            };
        } else {
            wordData = {
                word: wordStr,
                phonetic: '',
                meanings: [{ part: '', definition: '' }],
                isSentence: false
            };
        }
        return wordData;
    }
    return wordStr;
}

export async function generateQuestion(): Promise<void> {
    // 每次生成题目前加载最新设置
    loadSettings();

    // 上一题如果用户提交过答案，标记为已答
    if (appState.currentQuizWord && quizAnswerSubmitted) {
        quizAnsweredWords.add(appState.currentQuizWord.word);
        recordLearningHistory(appState.currentQuizWord.word, quizLastAnswerCorrect);
        appState.studyStats.todayWords++;
        appState.studyStats.learnedCount++;
        updateStudyStats();
        await updateWordSourceSelect();
        saveAnsweredWords();
        if (quizSession) {
            markAnswered(quizSession, appState.currentQuizWord.word, quizLastAnswerCorrect);
        }
        quizAnswerSubmitted = false;
    }

    // 跳过已答过的单词
    let skippedCount = 0;
    while (appState.quizWords.length > 0 && quizAnsweredWords.has(appState.quizWords[0].word)) {
        appState.quizWords.splice(0, 1);
        skippedCount++;
    }

    if (appState.quizWords.length === 0) {
        showQuizResult();
        return;
    }

    quizAnsweredCount++;
    updateQuizProgress();

    appState.errorCount = 0;
    appState.isWaitingForNextQuestion = false;
    appState.isProcessingAnswer = false;
    const quizFavBtn = document.getElementById('quiz-fav-btn') as HTMLButtonElement | null;
    if (quizFavBtn) quizFavBtn.style.display = 'none';
    const quizFeedback = document.getElementById('quiz-feedback') as HTMLElement;
    if (quizFeedback) {
        quizFeedback.textContent = '';
        quizFeedback.className = '';
    }
    const quizAnswerInput = document.getElementById('quiz-answer') as HTMLInputElement;
    quizAnswerInput.value = '';
    quizAnswerInput.disabled = false;
    updateSpellingFeedback();
    const quizModeSelect = document.getElementById('quiz-mode') as HTMLSelectElement;
    if (quizModeSelect && quizModeSelect.value === QuizMode.EnToZh) {
        quizAnswerInput.placeholder = '请输入答案，输入多个中文时用逗号分号或空格隔开，按Enter提交';
    } else if (quizModeSelect && quizModeSelect.value === QuizMode.Spelling) {
        quizAnswerInput.placeholder = '请根据释义拼写单词，按Enter提交';
    } else if (quizModeSelect && quizModeSelect.value === QuizMode.ListeningStuck) {
        quizAnswerInput.placeholder = '请听发音并写出听到的单词或句子，按Enter提交';
    } else {
        quizAnswerInput.placeholder = '请输入答案...按Enter提交';
    }
    quizAnswerInput.classList.remove('quiz-answer-hidden');
    // 等浏览器完成重排后再聚焦，避免 display:none 刚移除时 focus 失效
    requestAnimationFrame(() => quizAnswerInput.focus());
    const showAnswerBtn = document.getElementById('show-answer');
    if (showAnswerBtn) showAnswerBtn.style.display = 'inline-block';
    const nextQuestionBtn = document.getElementById('next-question');
    if (nextQuestionBtn) nextQuestionBtn.textContent = '下一题';

    // 选择一个单词：始终取第一个（列表已在startQuiz中按需打乱）
    let selectedIndex = 0;
    appState.currentQuizWord = appState.quizWords[selectedIndex];
    appState.quizWords.splice(selectedIndex, 1);

    quizAnswerSubmitted = false; // 重置提交标记

    // 如果没有释义，尝试获取翻译（不管是不是句子）
    const hasMeaning = appState.currentQuizWord.meanings &&
                      appState.currentQuizWord.meanings.length > 0 &&
                      appState.currentQuizWord.meanings[0].definition;

    if (!hasMeaning) {
        try {
            // 首先尝试搜索（包括缓存的翻译）
            const response = await fetch(`/api/search?word=${encodeURIComponent(appState.currentQuizWord.word)}`);
            const responseData = await response.json();

            if (responseData.success && responseData.data && responseData.data.translation) {
                // 找到了翻译，更新到 meanings 中
                appState.currentQuizWord.meanings = [{
                    part: '',
                    definition: responseData.data.translation
                }];
            } else if (responseData.success && responseData.data && responseData.data.meanings) {
                // 找到了词典释义
                appState.currentQuizWord.meanings = responseData.data.meanings;
            } else {
                // 没找到的话，直接调用翻译API（也会走缓存）
                const translateData = await apiTranslate(appState.currentQuizWord.word);

                if (translateData.success && translateData.translation) {
                    appState.currentQuizWord.meanings = [{
                        part: '',
                        definition: translateData.translation
                    }];
                }
            }
        } catch (e: unknown) {
            console.error('获取翻译出错:', e);
        }
    }

    // 解析释义并选择题目的释义
    const selectionResult = selectMeaningsForQuestion(
        appState.currentQuizWord.meanings || [],
        appState.currentQuizWord.word,
        {
            showAllMeanings: appState.settings.showAllMeanings,
            chineseCount: appState.settings.chineseCount,
            quizMultiPartProbability: appState.settings.quizMultiPartProbability,
        },
        appState.errorbook
    );
    const selectedMeanings = selectionResult.meanings;

    appState.currentQuizMeanings.length = 0;
    appState.currentQuizMeanings.push(...selectedMeanings); // 保存当前题目的释义，用于后续权重更新

    // 根据模式生成题目
    const quizQuestion = document.getElementById('quiz-question');
    if (!quizQuestion) return;

    if (appState.currentQuizMode === QuizMode.Dictation) {
        // 听写模式
        quizQuestion.innerHTML = `
            <p><strong>听写模式：</strong></p>
            <p style="margin-top: 10px;">请听发音并写出单词</p>
            <button class="quiz-play-btn" onclick="g('playPronunciation', '${appState.settings.pronunciationType}', '${escapeForJsString(appState.currentQuizWord.word)}')">
                🔊 播放发音
            </button>
        `;
        // 自动播放一次
        setTimeout(() => playPronunciation(appState.settings.pronunciationType, appState.currentQuizWord.word), 500);
    } else if (appState.currentQuizMode === QuizMode.ListeningStuck) {
        // 听力卡壳词追踪：听发音写单词/句子，答错可标记为卡壳词
        const isSentence = appState.currentQuizWord.word.includes(' ') || appState.currentQuizWord.isSentence;
        quizQuestion.innerHTML = `
            <p><strong>听力卡壳词追踪：</strong></p>
            <p style="margin-top: 10px;">${isSentence ? '请听发音并写出整句' : '请听发音并写出单词'}</p>
            <button class="quiz-play-btn" onclick="g('playPronunciation', '${appState.settings.pronunciationType}', '${escapeForJsString(appState.currentQuizWord.word)}')">
                🔊 播放发音
            </button>
            ${isSentence && appState.currentQuizWord.meanings && appState.currentQuizWord.meanings[0]?.definition
                ? `<p class="quiz-listening-hint" title="需要提示时再看">💡 中文参考：${escapeHtml(appState.currentQuizWord.meanings[0].definition)}</p>`
                : ''}
        `;
        // 自动播放一次
        setTimeout(() => playPronunciation(appState.settings.pronunciationType, appState.currentQuizWord.word), 500);
    } else if (appState.currentQuizMode === QuizMode.Spelling) {
        // 拼写模式：看中文释义拼写英文单词，支持发音提示与逐字符反馈
        const meaningsHtml = buildMeaningDisplayHtml(selectedMeanings, formatDefinitionHtml);

        const pronunciationKey = appState.settings.playPronunciationKey || '2';
        const speakerHtml = `<span id="quiz-speak-btn" class="quiz-speak-btn" title="播放发音（快捷键 ${pronunciationKey}）" onclick="g('playPronunciation', '${appState.settings.pronunciationType}', '${escapeForJsString(appState.currentQuizWord.word)}')">🔊</span>`;

        quizQuestion.innerHTML = `<p><strong>拼写模式：</strong></p><p>请根据释义拼写对应的英文单词</p><p class="quiz-zh-to-en-meanings">${meaningsHtml}${speakerHtml}</p>`;
    } else if (appState.currentQuizMode === QuizMode.ZhToEn) {
        // 中文 -> 英文模式
        const meaningsHtml = buildMeaningDisplayHtml(selectedMeanings, formatDefinitionHtml);

        const pronunciationKey = appState.settings.playPronunciationKey || '2';
        const speakerHtml = `<span id="quiz-speak-btn" class="quiz-speak-btn" title="播放发音（快捷键 ${pronunciationKey}）" onclick="g('playPronunciation', '${appState.settings.pronunciationType}', '${escapeForJsString(appState.currentQuizWord.word)}')">🔊</span>`;

        quizQuestion.innerHTML = `<p><strong>请写出对应的英文单词：</strong></p><p class="quiz-zh-to-en-meanings">${meaningsHtml}${speakerHtml}</p>`;
    } else {
        // 英文 -> 中文模式
        const pronunciationKey = appState.settings.playPronunciationKey || '2';
        const speakerHtml = `<span id="quiz-speak-btn" class="quiz-speak-btn" title="播放发音（快捷键 ${pronunciationKey}）" onclick="g('playPronunciation', '${appState.settings.pronunciationType}', '${escapeForJsString(appState.currentQuizWord.word)}')">🔊</span>`;

        const displayWord = normalizeCaseByType(appState.currentQuizWord.word);
        let questionHtml = `<p><strong>请写出对应的中文意思：</strong></p><p class="quiz-question-word">${escapeHtml(displayWord)}${speakerHtml}</p>`;
        if (appState.currentQuizWord.phonetic) {
            questionHtml += `<p class="quiz-question-phonetic">/${escapeHtml(appState.currentQuizWord.phonetic)}/</p>`;
        }
        quizQuestion.innerHTML = questionHtml;
    }

    // 生成新题目后滚动到测验区域，确保用户能看到所有内容
    scrollToQuizArea();
}

export function scrollToQuizArea(): void {
    const quizContainer = document.getElementById('quiz-container');
    if (quizContainer) {
        quizContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else {
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }
}

// 拼写模式：逐字符即时反馈（正确绿色、错误红色），完整拼写正确后自动提交
function updateSpellingFeedback(): void {
    const input = document.getElementById('quiz-answer') as HTMLInputElement | null;
    const feedback = document.getElementById('quiz-spelling-feedback');
    if (!input || !feedback) return;

    if (appState.currentQuizMode !== QuizMode.Spelling || !appState.currentQuizWord) {
        feedback.innerHTML = '';
        return;
    }

    const word = appState.currentQuizWord.word || '';
    const value = input.value;
    let html = '';
    let allCorrect = true;

    for (let i = 0; i < value.length; i++) {
        const char = value[i];
        const targetChar = word[i];
        if (targetChar && char.toLowerCase() === targetChar.toLowerCase()) {
            html += `<span class="spelling-char spelling-char-correct">${escapeHtml(char)}</span>`;
        } else {
            html += `<span class="spelling-char spelling-char-wrong">${escapeHtml(char)}</span>`;
            allCorrect = false;
        }
    }

    feedback.innerHTML = html;

    if (spellingAutoSubmitTimer) {
        clearTimeout(spellingAutoSubmitTimer);
        spellingAutoSubmitTimer = null;
    }

    if (value.length > 0 && value.length === word.length && allCorrect && !appState.isProcessingAnswer && !input.disabled) {
        spellingAutoSubmitTimer = setTimeout(() => {
            spellingAutoSubmitTimer = null;
            if (!appState.isProcessingAnswer && appState.currentQuizMode === QuizMode.Spelling) {
                checkAnswer();
            }
        }, 250);
    }
}

function updateQuizProgress(): void {
    const progressEl = document.getElementById('quiz-progress');
    const fill = document.getElementById('quiz-progress-fill');
    const text = document.getElementById('quiz-progress-text');
    if (progressEl) progressEl.style.display = 'flex';
    if (fill) fill.style.width = `${(quizAnsweredCount / quizTotalCount) * 100}%`;
    if (text) text.textContent = `${quizAnsweredCount}/${quizTotalCount}`;
}

export function checkAnswer(): void {
    // 如果正在处理答案中，直接返回
    if (appState.isProcessingAnswer) {
        return;
    }

    appState.isProcessingAnswer = true;

    const answerInput = document.getElementById('quiz-answer') as HTMLInputElement;
    if (!answerInput) { appState.isProcessingAnswer = false; return; }
    const answer = answerInput.value.trim();
    const feedback = document.getElementById('quiz-feedback') as HTMLElement;
    const isSentence = appState.currentQuizWord.word.includes(' ') || appState.currentQuizWord.isSentence;

    if (!answer) {
        feedback.textContent = '请输入答案';
        feedback.className = 'quiz-feedback-partial';
        appState.isProcessingAnswer = false;
        return;
    }

    let result = { isCorrect: false, isPartial: false };

    if (appState.currentQuizMode === QuizMode.EnToZh && isSentence) {
        // 句子模式：检查是否匹配翻译（quiz 特有逻辑：字符重叠度）
        if (appState.currentQuizWord.meanings && appState.currentQuizWord.meanings.length > 0 && appState.currentQuizWord.meanings[0].definition) {
            const correctTranslation = appState.currentQuizWord.meanings[0].definition;
            const overlap = [...correctTranslation].filter((ch: string) => answer.includes(ch)).length;
            const ratio = overlap / Math.max(correctTranslation.length, 1);
            result.isCorrect = ratio >= 0.5;
        }
    } else {
        result = checkQuizAnswer(
            answer,
            appState.currentQuizWord.word,
            appState.currentQuizWord.meanings || [],
            appState.currentQuizMode,
            isSentence
        );
    }

    if (result.isCorrect) {
        // 完全正确
        feedback.textContent = '回答正确！';
        feedback.className = 'quiz-feedback-success';
        animateCorrectFeedback(feedback);

        quizAnswerSubmitted = true;
        quizLastAnswerCorrect = true;

        (document.getElementById('quiz-answer') as HTMLInputElement).value = '';

        if (!isSentence) {
            playPronunciation(appState.settings.pronunciationType, appState.currentQuizWord.word);
        }

        if (appState.errorbook[appState.currentQuizWord.word]) {
            appState.errorbook[appState.currentQuizWord.word].correctCount++;

            if (appState.currentQuizMode !== QuizMode.Dictation) {
                appState.currentQuizMeanings.forEach(meaning => {
                    if (!appState.errorbook[appState.currentQuizWord.word].meaningWeights) {
                        appState.errorbook[appState.currentQuizWord.word].meaningWeights = {};
                    }
                    if (!appState.errorbook[appState.currentQuizWord.word].meaningWeights[meaning.definition]) {
                        appState.errorbook[appState.currentQuizWord.word].meaningWeights[meaning.definition] = {
                            weight: 1,
                            errorCount: 0,
                            correctCount: 0
                        };
                    }
                    appState.errorbook[appState.currentQuizWord.word].meaningWeights[meaning.definition].correctCount++;
                    appState.errorbook[appState.currentQuizWord.word].meaningWeights[meaning.definition].weight = Math.max(
                        0.1,
                        appState.errorbook[appState.currentQuizWord.word].meaningWeights[meaning.definition].weight * 0.9
                    );
                });
            }

            if (appState.errorbook[appState.currentQuizWord.word].correctCount >= appState.settings.errorCorrectCount) {
                delete appState.errorbook[appState.currentQuizWord.word];
            }

            localStorage.setItem('errorbook', JSON.stringify(appState.errorbook));
            initErrorbookVue();
            updateStudyStats();
        }

        setTimeout(() => {
            appState.isProcessingAnswer = false;
            showAnswer(false);
        }, 500);

        // 回答正确后滚动到测验区域，确保能看到答案
        scrollToQuizArea();
    } else if (result.isPartial) {
        // 部分正确，用户还可以继续尝试，不算答过
        feedback.textContent = '对了一部分哦，再检查检查';
        feedback.className = 'quiz-feedback-partial';

        appState.isProcessingAnswer = false;
    } else {
        // 完全错误
        appState.errorCount++;
        quizAnswerSubmitted = true;

        // 听力卡壳词追踪：记录到卡壳词列表
        if (appState.currentQuizMode === QuizMode.ListeningStuck) {
            markAsListeningStuck(appState.currentQuizWord);
        }

        if (!appState.errorbook[appState.currentQuizWord.word]) {
            appState.errorbook[appState.currentQuizWord.word] = {
                errorCount: 1,
                correctCount: 0,
                addedTime: new Date().getTime(),
                meaningWeights: {}
            };
        } else {
            appState.errorbook[appState.currentQuizWord.word].errorCount++;
            if (!appState.errorbook[appState.currentQuizWord.word].addedTime) {
                appState.errorbook[appState.currentQuizWord.word].addedTime = new Date().getTime();
            }
        }

        if (appState.currentQuizMode !== QuizMode.Dictation) {
            if (!appState.errorbook[appState.currentQuizWord.word].meaningWeights) {
                appState.errorbook[appState.currentQuizWord.word].meaningWeights = {};
            }
            appState.currentQuizMeanings.forEach(meaning => {
                if (!appState.errorbook[appState.currentQuizWord.word].meaningWeights[meaning.definition]) {
                    appState.errorbook[appState.currentQuizWord.word].meaningWeights[meaning.definition] = {
                        weight: 1,
                        errorCount: 0,
                        correctCount: 0
                    };
                }
                appState.errorbook[appState.currentQuizWord.word].meaningWeights[meaning.definition].errorCount++;
                appState.errorbook[appState.currentQuizWord.word].meaningWeights[meaning.definition].weight *= 1.1;
            });
        }

        localStorage.setItem('errorbook', JSON.stringify(appState.errorbook));
        initErrorbookVue();
        updateStudyStats();

        // 错题自动播放发音：根据设置中的阈值决定（0 表示不自动播放）
        const autoPlayThreshold = Number(appState.settings.autoPlayPronunciationAfterErrors) || 0;
        if (autoPlayThreshold > 0 && appState.errorCount >= autoPlayThreshold && !isSentence) {
            playPronunciation(appState.settings.pronunciationType, appState.currentQuizWord.word);
        }

        if (appState.currentQuizMode === QuizMode.ListeningStuck) {
            feedback.textContent = '已标记为听力卡壳词，按Enter查看答案并继续';
        } else if (appState.errorCount >= 2) {
            feedback.textContent = '拼写错误，请检查拼写';
        } else {
            feedback.textContent = '回答错误，请再试一次';
        }
        feedback.className = 'quiz-feedback-error';
        animateErrorShake(feedback);

        appState.isProcessingAnswer = false;
    }
}

function markAsListeningStuck(wordData: QuizWordData): void {
    const word = wordData.word;
    const existing = appState.listeningStuckWords[word];
    appState.listeningStuckWords[word] = {
        word,
        phonetic: wordData.phonetic || existing?.phonetic,
        meanings: (wordData.meanings && wordData.meanings.length > 0) ? wordData.meanings : existing?.meanings,
        stuckCount: (existing?.stuckCount || 0) + 1,
        lastStuckTime: Date.now(),
    };
    if (!currentRoundStuckWords.includes(word)) {
        currentRoundStuckWords.push(word);
    }
}

export function showAnswer(manual: boolean = false): void {
    const quizQuestion = document.getElementById('quiz-question');
    const feedback = document.getElementById('quiz-feedback') as HTMLElement;
    const quizAnswerInput = document.getElementById('quiz-answer') as HTMLInputElement;
    const isSentence = appState.currentQuizWord.word.includes(' ') || appState.currentQuizWord.isSentence;

    if (!quizQuestion) return;

    let answerHtml = `<p><strong>正确答案：</strong></p>`;
    const displayWord = normalizeCaseByType(appState.currentQuizWord.word);
    answerHtml += `<p class="quiz-answer-word">${escapeHtml(displayWord)}</p>`;
    if (!isSentence && appState.currentQuizWord.phonetic) {
        answerHtml += `<p class="quiz-answer-phonetic">/${appState.currentQuizWord.phonetic}/</p>`;
    }

    // 只对于单词显示释义标题，对于句子直接显示翻译
    if (isSentence) {
        if (appState.currentQuizWord.meanings && appState.currentQuizWord.meanings.length > 0 && appState.currentQuizWord.meanings[0].definition) {
            answerHtml += `<div class="quiz-answer-section-heading"><strong>翻译：</strong></div>`;
            answerHtml += `<div style="margin-top: 5px;">${formatDefinitionHtml(appState.currentQuizWord.meanings[0].definition)}</div>`;
        }
    } else {
        answerHtml += `<div class="quiz-answer-section-heading"><strong>释义：</strong></div>`;
        appState.currentQuizWord.meanings.forEach((meaning: { part: string; definition: string }) => {
            answerHtml += `<div class="quiz-answer-meaning-row">`;
            if (meaning.part) {
                answerHtml += `<span class="quiz-answer-meaning-part">${meaning.part}</span>`;
            }
            answerHtml += `<span>${formatDefinitionHtml(meaning.definition)}</span>`;
            answerHtml += `</div>`;
        });
    }

    quizQuestion.innerHTML = answerHtml;

    // 显示答案后滚动到测验区域，确保能看到所有内容
    scrollToQuizArea();

    // 如果是单词，获取并显示一句随机例句
    if (!isSentence) {
        (async () => {
            try {
                const examplesResponse = await fetch('/api/examples?word=' + encodeURIComponent(appState.currentQuizWord.word));
                const examplesData = await examplesResponse.json();
                if (examplesData.success && examplesData.data && examplesData.data.length > 0) {
                    // 随机选择一句例句
                    const randomIndex = Math.floor(Math.random() * examplesData.data.length);
                    const example = examplesData.data[randomIndex];

                    // 给例句单词加链接
                    let exampleText = example.text;
                    exampleText = exampleText.replace(/([a-zA-Z]+(?:'[a-zA-Z]+)?)/g, function(match: string) {
                        return '<a href="#" onclick="g(\'jumpToWord\', \'' + escapeForJsString(match.toLowerCase()) + '\'); return false;" class="quiz-clickable-word">' + escapeHtml(match) + '</a>';
                    });

                    let exampleHtml = '<div class="quiz-example-section">';
                    exampleHtml += '<h3 class="quiz-example-heading">';
                    exampleHtml += '<span>📖</span> 例句';
                    exampleHtml += '</h3>';
                    exampleHtml += '<div class="quiz-example-card">';
                    exampleHtml += '<div class="quiz-example-badge-row">';
                    exampleHtml += '<span class="quiz-example-lang-badge">英文</span>';
                    exampleHtml += '</div>';
                    exampleHtml += '<div class="quiz-example-text">' + exampleText + '</div>';
                    exampleHtml += '<div class="quiz-example-translation">';
                    exampleHtml += '<span class="quiz-example-zh-label">中文:</span>' + example.translation;
                    exampleHtml += '</div>';
                    exampleHtml += '</div>';
                    exampleHtml += '</div>';

                    quizQuestion.innerHTML += exampleHtml;
                }
            } catch (e: unknown) {
                console.error('获取例句失败:', e);
            }
        })();
    }

    if (feedback) {
        feedback.textContent = '答案已显示，按Enter键进入下一题';
        feedback.className = 'quiz-feedback-info';
    }

    // 清空输入框，保持启用状态，修改提示词并聚焦
    quizAnswerInput.value = '';
    quizAnswerInput.disabled = false;
    quizAnswerInput.placeholder = '可以输入答案巩固一下哦';
    updateSpellingFeedback();
    requestAnimationFrame(() => quizAnswerInput.focus());

    appState.isWaitingForNextQuestion = true;
    quizAnswerSubmitted = true;
    quizLastAnswerCorrect = false;

    const quizFavBtn = document.getElementById('quiz-fav-btn') as HTMLButtonElement | null;
    if (quizFavBtn) {
        quizFavBtn.style.display = 'inline-block';
        quizFavBtn.textContent = '加入收藏';
        quizFavBtn.disabled = false;
    }

    // 只有手动点击「显示答案」时才触发自动加入错题本，答对后自动显示答案不触发
    if (manual && appState.settings.addToErrorbookAfterShowAnswer && appState.currentQuizWord && !isSentence) {
        const word = appState.currentQuizWord.word;
        if (!appState.errorbook[word]) {
            appState.errorbook[word] = {
                errorCount: 1,
                correctCount: 0,
                addedTime: new Date().getTime(),
                meaningWeights: {}
            };
            localStorage.setItem('errorbook', JSON.stringify(appState.errorbook));
            initErrorbookVue();
            updateStudyStats();
        }
    }

    // 添加Enter键事件监听，按Enter键进入下一题
    if (_showAnswerEnterHandler) {
        document.removeEventListener('keyup', _showAnswerEnterHandler);
    }
    _showAnswerEnterHandler = function(e: KeyboardEvent) {
        if (e.key === 'Enter' && appState.isWaitingForNextQuestion) {
            appState.isWaitingForNextQuestion = false;
            document.removeEventListener('keyup', _showAnswerEnterHandler!);
            _showAnswerEnterHandler = null;
            nextQuestion();
        }
    };
    document.addEventListener('keyup', _showAnswerEnterHandler);
}

// 结束测验（中途退出）
export async function endQuiz(): Promise<void> {
    if (!quizSession || appState.quizWords.length === 0) {
        // 已经自然结束，直接回设置区
        showQuizSettingsArea();
        return;
    }
    const save = await showConfirm(
        '是否保存本轮答题进度？\n\n选"是"保存进度，选"否"放弃本轮答题记录',
        '结束测验'
    );
    if (save) {
        endSessionWithSave(quizSession);
    } else {
        endSessionWithRollback(quizSession);
        // 回退后刷新单词来源统计
        await updateWordSourceSelect();
    }
    quizSession = null;
    showQuizSettingsArea();
}

// 继续上一轮答题（从中断处继续）
export async function continueQuiz(): Promise<void> {
    const state = loadSessionState();
    if (!state) return;
    quizSession = state;
    appState.quizWords = state.words.slice(state.currentIndex);
    quizTotalCount = state.words.length;
    quizAnsweredCount = state.currentIndex;
    quizAnsweredWords = new Set(state.quizAnsweredWordsSnapshot);
    // 合并本轮已答
    state.answeredInThisRound.forEach(w => quizAnsweredWords.add(w));
    appState.currentQuizMode = document.getElementById('quiz-mode')
        ? (document.getElementById('quiz-mode') as HTMLSelectElement).value as QuizMode
        : QuizMode.EnToZh;
    showQuizAnswerArea();
    const quizContainer = document.getElementById('quiz-container');
    if (quizContainer) quizContainer.classList.add('quiz-container-visible');
    await generateQuestion();
}

// 重新开始上一轮答题（使用同一单词列表重头来）
export async function redoQuiz(): Promise<void> {
    const state = loadSessionState();
    if (!state) return;
    quizSession = createSession('quiz', state.source, state.words);
    saveSessionState(quizSession);
    appState.quizWords = [...state.words];
    quizTotalCount = state.words.length;
    quizAnsweredCount = 0;
    quizAnsweredWords = new Set();
    loadAnsweredWords();
    appState.currentQuizMode = document.getElementById('quiz-mode')
        ? (document.getElementById('quiz-mode') as HTMLSelectElement).value as QuizMode
        : QuizMode.EnToZh;
    showQuizAnswerArea();
    const quizContainer = document.getElementById('quiz-container');
    if (quizContainer) quizContainer.classList.add('quiz-container-visible');
    await generateQuestion();
}

function buildCurrentRoundStuckWordsHtml(): string {
    if (currentRoundStuckWords.length === 0) return '';
    const items = currentRoundStuckWords.map(word => {
        const stuck = appState.listeningStuckWords[word];
        const meaning = stuck?.meanings && stuck.meanings[0]?.definition
            ? escapeHtml(stuck.meanings[0].definition)
            : '';
        return `<li class="quiz-stuck-word-item">
            <span class="quiz-stuck-word-text" onclick="g('jumpToWord', '${escapeForJsString(word)}')">${escapeHtml(word)}</span>
            ${meaning ? `<span class="quiz-stuck-word-meaning">${meaning}</span>` : ''}
            <span class="quiz-stuck-word-count">卡壳 ${stuck?.stuckCount || 1} 次</span>
        </li>`;
    }).join('');
    return `
        <div class="quiz-stuck-words-section">
            <h4>本轮听力卡壳词</h4>
            <ul class="quiz-stuck-words-list">${items}</ul>
            <p class="quiz-stuck-words-tip">点击单词可跳转查词，重点练习这些词的发音。</p>
        </div>
    `;
}

// 显示测验完成结果界面
function showQuizResult(): void {
    if (!quizSession) return;
    endSessionComplete(quizSession);
    // 清理可能残留的结果快捷键
    hideQuizResult();

    const source = quizSession.source;
    const { total: sourceTotal, remaining: sourceRemaining } = getSourceProgress(source);
    const allCompleted = sourceTotal > 0 && sourceRemaining === 0;

    // 空 session 且未全部完成：没有可用单词，直接回设置区
    if (quizSession.words.length === 0 && !allCompleted) {
        void showAlert('没有可用的单词，请先添加单词到单词本或收藏。');
        showQuizSettingsArea();
        return;
    }

    const quizContainer = document.getElementById('quiz-container');
    if (quizContainer) quizContainer.classList.remove('quiz-container-visible');
    const quizAnswer = document.getElementById('quiz-answer');
    if (quizAnswer) quizAnswer.classList.add('quiz-answer-hidden');
    const progress = document.getElementById('quiz-progress');
    if (progress) progress.style.display = 'none';

    const result = document.getElementById('quiz-result');
    if (!result) return;
    result.style.display = 'block';
    // words 可能被意外清空，用 answeredInThisRound 兜底统计
    const total = quizSession.words.length || quizSession.answeredInThisRound.length;
    const correct = quizSession.correctCount;
    const wrong = quizSession.wrongCount;
    const accuracy = total > 0 ? Math.round((correct / total) * 100) : 0;

    const stuckWordsHtml = buildCurrentRoundStuckWordsHtml();

    if (allCompleted) {
        const loopCount = getLoopCount(source);
        result.innerHTML = `
            <div class="quiz-result-card quiz-result-all-completed">
                <h3>恭喜你，该单词本所有单词已经测验完毕！</h3>
                <div class="review-stat-row">该单词本总共的单词数：<span class="review-stat-val">${sourceTotal}</span></div>
                <div class="review-stat-row">答对的单词：<span class="review-stat-val">${correct}</span></div>
                <div class="review-stat-row">答错的单词：<span class="review-stat-val">${wrong}</span></div>
                <div class="review-stat-row">循环次数：<span class="review-stat-val">${loopCount}</span></div>
                ${stuckWordsHtml}
                <div class="quiz-result-actions">
                    <button id="quiz-restart-wordbook" class="btn-gradient btn-green">重新测验该单词本</button>
                    <button id="quiz-finish" class="btn-gradient btn-red">结束测验</button>
                </div>
                <div class="quiz-result-hints">
                    <span>按 空格键 重新测验该单词本</span>
                    <span>按 Esc 键 结束测验</span>
                </div>
            </div>
        `;
        const restartBtn = document.getElementById('quiz-restart-wordbook');
        const finishBtn = document.getElementById('quiz-finish');
        if (restartBtn) restartBtn.addEventListener('click', () => confirmRestartCurrentWordbook());
        if (finishBtn) finishBtn.addEventListener('click', () => {
            quizSession = null;
            hideQuizResult();
            showQuizSettingsArea();
        });

        const handler = (e: KeyboardEvent) => {
            const resultEl = document.getElementById('quiz-result');
            if (!resultEl || resultEl.style.display === 'none') return;
            if (e.key === ' ') {
                e.preventDefault();
                void confirmRestartCurrentWordbook();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                quizSession = null;
                showQuizSettingsArea();
            }
        };
        document.addEventListener('keydown', handler, { once: false });
        (result as any)._keyHandler = handler;
        return;
    }

    result.innerHTML = `
        <div class="quiz-result-card">
            <h3>测验完成！</h3>
            <div class="review-stat-row">总题数：<span class="review-stat-val">${total}</span></div>
            <div class="review-stat-row">答对：<span class="review-stat-val">${correct}</span></div>
            <div class="review-stat-row">答错：<span class="review-stat-val">${wrong}</span></div>
            <div class="review-stat-row">正确率：<span class="review-stat-val">${accuracy}%</span></div>
            ${stuckWordsHtml}
            <div class="quiz-result-actions">
                <button id="quiz-retry" class="btn-gradient btn-green">重新测验</button>
                <button id="quiz-next-round" class="btn-gradient btn-blue">开始下一轮</button>
                <button id="quiz-finish" class="btn-gradient btn-red">结束测验</button>
            </div>
            <div class="quiz-result-hints">
                <span>按 空格键 重新测验</span>
                <span>按 Enter 键 开始下一轮答题</span>
                <span>按 Esc 键 结束测验</span>
            </div>
        </div>
    `;

    // 绑定结果按钮
    const retryBtn = document.getElementById('quiz-retry');
    const nextRoundBtn = document.getElementById('quiz-next-round');
    const finishBtn = document.getElementById('quiz-finish');
    if (retryBtn) retryBtn.addEventListener('click', () => retryQuiz());
    if (nextRoundBtn) nextRoundBtn.addEventListener('click', () => startNextRound());
    if (finishBtn) finishBtn.addEventListener('click', () => {
        quizSession = null;
        hideQuizResult();
        showQuizSettingsArea();
    });

    // 快捷键
    const handler = (e: KeyboardEvent) => {
        const resultEl = document.getElementById('quiz-result');
        if (!resultEl || resultEl.style.display === 'none') return;
        if (e.key === ' ') {
            e.preventDefault();
            retryQuiz();
        } else if (e.key === 'Enter') {
            e.preventDefault();
            startNextRound();
        } else if (e.key === 'Escape') {
            e.preventDefault();
            quizSession = null;
            showQuizSettingsArea();
        }
    };
    document.addEventListener('keydown', handler, { once: false });
    // 存储以便清理
    (result as any)._keyHandler = handler;
}

function hideQuizResult(): void {
    const result = document.getElementById('quiz-result');
    if (result) {
        result.style.display = 'none';
        const handler = (result as any)._keyHandler;
        if (handler) {
            document.removeEventListener('keydown', handler);
            (result as any)._keyHandler = null;
        }
    }
}

// 重新测验（同一单词列表）
async function retryQuiz(): Promise<void> {
    const state = quizSession;
    if (!state) return;
    clearSessionState();
    quizSession = createSession('quiz', state.source, state.words);
    saveSessionState(quizSession);
    appState.quizWords = [...state.words];
    quizTotalCount = state.words.length;
    quizAnsweredCount = 0;
    quizAnsweredWords = new Set();
    hideQuizResult();
    const quizContainer = document.getElementById('quiz-container');
    if (quizContainer) quizContainer.classList.add('quiz-container-visible');
    await generateQuestion();
}

// 开始下一轮（同一来源，过滤已练习）
async function startNextRound(): Promise<void> {
    const state = quizSession;
    if (!state) return;
    hideQuizResult();
    clearSessionState();
    // 重新触发 startQuiz，但会过滤已练习的
    await startQuiz();
}

// 二次确认后重新测验整个单词本：清空该来源进度、循环次数+1
async function confirmRestartCurrentWordbook(): Promise<void> {
    const ok = await showConfirm('重新测验该单词本将会清除已练习和未练习的数据，是否继续？', '重新测验确认');
    if (!ok) return;
    await restartCurrentWordbook();
}

async function restartCurrentWordbook(): Promise<void> {
    const state = quizSession;
    if (!state) return;
    const source = state.source;
    incrementLoopCount(source);
    clearSourceProgress(source);
    await updateWordSourceSelect();
    hideQuizResult();
    clearSessionState();
    await startQuiz();
}

// 设置区入口：重新测验当前选中的单词本
async function restartWordbookFromSettings(): Promise<void> {
    const wordSourceEl = document.getElementById('word-source') as HTMLSelectElement | null;
    if (!wordSourceEl) return;
    const source = wordSourceEl.value;
    if (!source.startsWith('wordbook:') && !source.startsWith('system:')) return;

    incrementLoopCount(source);
    clearSourceProgress(source);
    await updateWordSourceSelect();
    clearSessionState();
    await startQuiz();
}