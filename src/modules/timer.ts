// 学习计时器：跟踪今日/总计学习时长
// 策略：在答题/背单词页面每 tick 1 秒累加一次；页面失焦/切换到非学习页面自动暂停
// 注意：启动/停止由 onPageEnter/onPageLeave 回调在 main.ts 中控制

import { appState } from '../store';
import { formatDuration } from './stats';

let timerInterval: ReturnType<typeof setInterval> | null = null;
let isRunning = false;
let lastActivityTime = 0;
const IDLE_THRESHOLD_MS = 60_000; // 60秒无操作视为空闲，暂停计时

/** 记录用户活动，防止空闲误判 */
export function recordActivity(): void {
    lastActivityTime = Date.now();
}

/** 每秒 tick：累加学习时长 */
function tick(): void {
    if (!isRunning) return;
    const now = Date.now();
    // 空闲检测：超过阈值不继续累加
    if (now - lastActivityTime > IDLE_THRESHOLD_MS) return;

    appState.studyStats.todaySeconds = (appState.studyStats.todaySeconds || 0) + 1;
    appState.studyStats.totalSeconds = (appState.studyStats.totalSeconds || 0) + 1;
    updateStudyTimerDisplay();
    // 每 10 秒持久化一次，避免频繁写 storage
    if (appState.studyStats.todaySeconds % 10 === 0) {
        localStorage.setItem('studyStats', JSON.stringify(appState.studyStats));
    }
}

/** 更新侧边栏计时器显示 */
export function updateStudyTimerDisplay(): void {
    const todayTimeEl = document.getElementById('today-time');
    const totalTimeEl = document.getElementById('total-time');
    const todaySecs = appState.studyStats.todaySeconds || 0;
    const totalSecs = appState.studyStats.totalSeconds || 0;
    if (todayTimeEl) todayTimeEl.textContent = formatDuration(todaySecs);
    if (totalTimeEl) totalTimeEl.textContent = formatDuration(totalSecs);
}

/** 启动计时器 */
export function startStudyTimer(): void {
    if (isRunning) return;
    isRunning = true;
    lastActivityTime = Date.now();
    timerInterval = setInterval(tick, 1000);
}

/** 停止计时器 */
export function stopStudyTimer(): void {
    if (!isRunning) return;
    isRunning = false;
    if (timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
    }
    // 停止时持久化一次
    localStorage.setItem('studyStats', JSON.stringify(appState.studyStats));
}

/** 用户活动事件监听（mousemove/keydown/click） */
function onUserActivity(): void {
    lastActivityTime = Date.now();
}

/** 页面可见性变化处理 */
function onVisibilityChange(): void {
    if (document.hidden) {
        stopStudyTimer();
    }
}

/** 初始化计时器：绑定全局事件监听 */
export function initStudyTimer(): void {
    document.addEventListener('mousemove', onUserActivity, { passive: true });
    document.addEventListener('keydown', onUserActivity);
    document.addEventListener('click', onUserActivity);
    document.addEventListener('visibilitychange', onVisibilityChange);

    // 初始显示
    updateStudyTimerDisplay();
}
