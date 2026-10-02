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

/** 当前是否真正处于练习状态（而非浏览 / 配置 / 查词） */
function isPracticing(): boolean {
    const pageActive = (id: string): boolean => {
        const el = document.getElementById(id);
        return !!el && el.classList.contains('active');
    };
    const barVisible = (sel: string): boolean => {
        const b = document.querySelector(sel) as HTMLElement | null;
        return !!b && b.offsetParent !== null;
    };
    // 单词测验进行中（答题进度条可见）
    if (pageActive('quiz-page') && barVisible('#quiz-page #quiz-progress')) return true;
    // 单词复习进行中
    if (pageActive('review-page') && barVisible('#review-page #review-progress')) return true;
    // 模拟题做题页 / 交卷后复习（首页与题库列表无 .ex-practice）
    if (pageActive('exam-page') && document.querySelector('#exam-page .ex-practice')) return true;
    return false;
}

/** 每秒 tick：累加学习时长 */
function tick(): void {
    if (!isRunning) return;
    const now = Date.now();
    // 空闲检测：超过阈值不继续累加
    if (now - lastActivityTime > IDLE_THRESHOLD_MS) return;
    // 仅在真正练习（测验 / 复习 / 模拟题做题）时累加，浏览、查词、设置、配置页不计时
    if (!isPracticing()) return;

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
    } else {
        // 页面恢复可见时，检查是否在学习页面，是则重启计时器
        recordActivity();
        const activePage = document.querySelector('.content-page.active');
        if (activePage) {
            const pageId = activePage.id.replace('-page', '');
            if (['quiz', 'review', 'exam'].includes(pageId)) {
                startStudyTimer();
            }
        }
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
