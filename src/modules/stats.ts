// 学习统计面板：统计计算、渲染、每日重置

import { appState, showAlert, showConfirm } from '../global';
import { updateWordbookSelect, updateSelectedWordbookDisplay } from './wordbook';
import { animateStatNumber, animateProgressBar } from '../utils/gsap';

export function initStudyStats(): void {
    const clearStatsBtn = document.getElementById('clear-stats');
    if (clearStatsBtn) {
        clearStatsBtn.addEventListener('click', async function() {
            const ok = await showConfirm('确定要清空所有学习数据吗？该操作不可恢复！', '清空数据');
            if (ok) {
                clearStudyStats();
            }
        });
    }
    updateStudyStats();
}

export function clearStudyStats(): void {
    appState.studyStats.totalWords = 0;
    appState.studyStats.learnedCount = 0;
    appState.studyStats.searchCount = 0;
    appState.studyStats.studyDays = 0;
    appState.studyStats.todayWords = 0;
    appState.studyStats.errorWords = 0;
    appState.studyStats.todaySeconds = 0;
    appState.studyStats.totalSeconds = 0;
    appState.studyStats.lastStudyDate = new Date().toDateString();

    // 清空收藏（数组直接置空）
    appState.favorites.splice(0, appState.favorites.length);
    // 清空自建单词本
    for (const key of Object.keys(appState.wordbooks)) {
        delete appState.wordbooks[key];
    }
    // 清空错题本
    for (const key of Object.keys(appState.errorbook)) {
        delete appState.errorbook[key];
    }

    void showAlert('学习数据已清空！');

    updateStudyStats();
    updateWordbookSelect();
    updateSelectedWordbookDisplay();
}

export function updateStudyStats(): void {
    const today = new Date().toDateString();
    if (appState.studyStats.lastStudyDate !== today) {
        // 新的一天：重置今日数据，但不立即递增学习天数
        // 学习天数在用户第一次答题/学习时递增（由 incrementStudyDay 调用）
        appState.studyStats.todayWords = 0;
        appState.studyStats.todaySeconds = 0;
        appState.studyStats.lastStudyDate = today;
    }

    // totalWords 保留为收藏+单词本总数， learnedCount 为「总学习单词数」
    let totalWords = appState.favorites.length;
    for (const name in appState.wordbooks) {
        totalWords += appState.wordbooks[name].length;
    }
    appState.studyStats.totalWords = totalWords;

    // 兼容旧数据：之前没有 learnedCount，用 totalWords 兜底
    if (typeof appState.studyStats.learnedCount !== 'number') {
        appState.studyStats.learnedCount = totalWords;
    }

    let errorWords = 0;
    for (const word in appState.errorbook) {
        errorWords++;
    }
    appState.studyStats.errorWords = errorWords;

    appState.studyStats.tomorrowWords = appState.settings.dailyWordCount || 20;

    const totalWordsEl = document.getElementById('total-words');
    const searchCountEl = document.getElementById('search-count');
    const studyDaysEl = document.getElementById('study-days');
    const todayWordsEl = document.getElementById('today-words');
    const errorWordsEl = document.getElementById('error-words');
    const tomorrowWordsEl = document.getElementById('tomorrow-words');
    const todayTimeEl = document.getElementById('today-time');
    const totalTimeEl = document.getElementById('total-time');

    const total = Number(appState.studyStats.learnedCount) || 0;
    const searchCnt = Number(appState.studyStats.searchCount) || 0;
    const days = Number(appState.studyStats.studyDays) || 0;
    const todayWords = Number(appState.studyStats.todayWords) || 0;
    const err = Number(appState.studyStats.errorWords) || 0;
    const tomorrow = Number(appState.studyStats.tomorrowWords) || 0;
    const todaySecs = Number(appState.studyStats.todaySeconds) || 0;
    const totalSecs = Number(appState.studyStats.totalSeconds) || 0;

    animateStatNumber(totalWordsEl as HTMLElement, total);
    animateStatNumber(searchCountEl as HTMLElement, searchCnt);
    animateStatNumber(studyDaysEl as HTMLElement, days);
    animateStatNumber(todayWordsEl as HTMLElement, todayWords);
    animateStatNumber(errorWordsEl as HTMLElement, err);
    animateStatNumber(tomorrowWordsEl as HTMLElement, tomorrow);
    if (todayTimeEl) todayTimeEl.textContent = formatDuration(todaySecs);
    if (totalTimeEl) totalTimeEl.textContent = formatDuration(totalSecs);

    const progressFill = document.getElementById('study-progress-fill') as HTMLElement;
    if (progressFill && appState.studyStats.todayWords > 0) {
        const pct = Math.min(100, Math.round((appState.studyStats.todayWords / (appState.studyStats.tomorrowWords || 20)) * 100));
        animateProgressBar(progressFill, pct);
    }

    localStorage.setItem('studyStats', JSON.stringify(appState.studyStats));
}

/** 当用户第一次在新的一天开始学习时，递增学习天数 */
export function incrementStudyDay(): void {
    const today = new Date().toDateString();
    if (appState.studyStats.lastStudyDate !== today) {
        appState.studyStats.todayWords = 0;
        appState.studyStats.todaySeconds = 0;
        appState.studyStats.studyDays++;
        appState.studyStats.lastStudyDate = today;
    }
}

/** 格式化秒数为可读时长 */
export function formatDuration(seconds: number): string {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h > 0) return `${h}小时${m}分`;
    if (m > 0) return `${m}分${s}秒`;
    return `${s}秒`;
}

export function updateTomorrowWords(): void {
    const dailyCount = appState.settings.dailyWordCount || 20;
    const tomorrowWordsEl = document.getElementById('tomorrow-words');
    if (tomorrowWordsEl) {
        tomorrowWordsEl.textContent = String(dailyCount);
    }
    appState.studyStats.tomorrowWords = dailyCount;
    localStorage.setItem('studyStats', JSON.stringify(appState.studyStats));
    const quizCountInput = document.getElementById('quiz-count') as HTMLInputElement;
    if (quizCountInput) {
        quizCountInput.value = String(dailyCount);
    }
}

