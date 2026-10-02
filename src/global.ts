import { appState } from './store';
export { appState };

import { searchWord } from './modules/dictionary';
import { PageSection, WordSource } from './types/enums';
import { animatePageEnter, showToast, prefersReducedMotion } from './utils/gsap';
import { SYSTEM_WORDBOOKS, MAX_RENDERED_PAGES } from './constants';
import { trapFocus, TrapHandle } from './utils/focusTrap';

// 当前所在页面 + 切换锁，防止连续点击叠加
let currentSection = PageSection.Dictionary;
export { currentSection };
let isSwitching = false;
let pendingSection: PageSection | null = null;

// 已切到后台的页面顺序（最久未访问在队首），供内存过高时按 LRU 释放
let renderedOrder: string[] = [];

/** 动态刷新测验页单词来源选择器（避免 global.ts 与 wordbook.ts 循环依赖） */
async function refreshWordSourceSelect(): Promise<void> {
    const { updateWordSourceSelect } = await import('./modules/wordbook');
    await updateWordSourceSelect();
}

/** 检查字符串是否包含中文字符 */
export function hasChinese(text: string): boolean {
    return /[\u4e00-\u9fff]/.test(text);
}

/** 切换全屏模式 */
export function toggleFullscreen(): void {
    if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(() => {});
    } else {
        document.exitFullscreen().catch(() => {});
    }
}

/** 复制文本到剪贴板 */
export async function copyToClipboard(text: string): Promise<boolean> {
    try {
        await navigator.clipboard.writeText(text);
        return true;
    } catch {
        // 回退方案：使用 execCommand
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.left = '-9999px';
        document.body.appendChild(textarea);
        textarea.select();
        const success = document.execCommand('copy');
        document.body.removeChild(textarea);
        return success;
    }
}

export function applyTheme(): void {
    if (appState.isDarkMode) {
        document.documentElement.classList.add('dark-mode');
        document.body.classList.add('dark-mode');
        const themeToggle = document.getElementById('theme-toggle');
        if (themeToggle) {
            themeToggle.textContent = '☀️';
            themeToggle.title = '切换到浅色模式';
        }
    } else {
        document.documentElement.classList.remove('dark-mode');
        document.body.classList.remove('dark-mode');
        const themeToggle = document.getElementById('theme-toggle');
        if (themeToggle) {
            themeToggle.textContent = '🌙';
            themeToggle.title = '切换到深色模式';
        }
    }
}

let lastThemeToggleAt = 0;
export function toggleTheme(event?: MouseEvent): void {
    const themeBtn = document.getElementById('theme-toggle');
    if (!themeBtn) return;
    const nowMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
    // 双保险防连点：动画进行中（可见窗口）或距上次切换不足 480ms（后台标签 / reduced-motion /
    // 不支持 View Transitions 时动画会被跳过、data-animating 提前释放）均忽略，避免主题来回横跳
    if (themeBtn.getAttribute('data-animating') === '1' || nowMs - lastThemeToggleAt < 480) return;
    lastThemeToggleAt = nowMs;

    const newDarkMode = !appState.isDarkMode;

    // 圆形揭示圆心：优先点击坐标，否则取主题按钮中心，再兜底右上角
    let x = window.innerWidth - 90;
    let y = 70;
    if (event && typeof event.clientX === 'number' && (event.clientX !== 0 || event.clientY !== 0)) {
        x = event.clientX;
        y = event.clientY;
    } else {
        const r = themeBtn.getBoundingClientRect();
        if (r.width > 0) { x = r.left + r.width / 2; y = r.top + r.height / 2; }
    }
    const maxRadius = Math.hypot(
        Math.max(x, window.innerWidth - x),
        Math.max(y, window.innerHeight - y)
    );

    const apply = (): void => {
        appState.isDarkMode = newDarkMode;
        localStorage.setItem('darkMode', String(newDarkMode));
        applyTheme();
    };

    // Electron 28 / Chromium 120 起支持 View Transitions：浏览器对切换前后整页各拍一张快照，
    // 仅对 ::view-transition-new(root) 这一个合成层做 clip-path 圆形扩散，
    // 无需创建遮罩 DOM、无需读取上百个元素的布局，主线程零强制回流，动画流畅不抖动。
    const startVT = (document as any).startViewTransition
        ? (document as any).startViewTransition.bind(document)
        : null;

    if (!prefersReducedMotion() && typeof startVT === 'function') {
        themeBtn.setAttribute('data-animating', '1');
        let transition: any;
        try {
            transition = startVT(() => { apply(); });
        } catch {
            apply();
            themeBtn.removeAttribute('data-animating');
            return;
        }
        transition.ready
            .then(() => document.documentElement.animate(
                {
                    clipPath: [
                        `circle(0px at ${x}px ${y}px)`,
                        `circle(${Math.ceil(maxRadius) + 20}px at ${x}px ${y}px)`,
                    ],
                },
                {
                    duration: 520,
                    easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
                    pseudoElement: '::view-transition-new(root)',
                }
            ).finished)
            .catch(() => {})
            .finally(() => themeBtn.removeAttribute('data-animating'));
        return;
    }

    // 兜底（无 View Transitions 或开启“减少动态”）：直接切换 + 极短淡入，不创建遮罩、不操作布局
    apply();
    if (!prefersReducedMotion()) {
        document.documentElement.animate(
            { opacity: [0.94, 1] },
            { duration: 200, easing: 'ease-out' }
        );
    }
}

// HTML转义函数
export function escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

export function escapeForJsString(text: string): string {
    return text
        .replace(/\\/g, '\\\\')
        .replace(/'/g, "\\'")
        .replace(/"/g, '\\"')
        .replace(/\n/g, '\\n')
        .replace(/\r/g, '\\r');
}

// 系统单词本常量（从共享常量导入，tags 已统一为数组）
export const systemWordbooks = SYSTEM_WORDBOOKS.map(wb => ({
    id: wb.id,
    name: wb.name,
    tags: wb.tags,
}));

export function setupNavbar(): void {
    const navbarToggle = document.getElementById('navbar-toggle');
    const navbarNav = document.getElementById('navbar-nav');
    const navLinks = document.querySelectorAll('.nav-link');

    if (!navbarToggle || !navbarNav) return;

    // 移动端导航切换
    navbarToggle.addEventListener('click', function() {
        navbarNav.classList.toggle('active');
    });

    // 导航链接点击事件
    navLinks.forEach(link => {
        link.addEventListener('click', function(this: HTMLAnchorElement, e: Event) {
            e.preventDefault();

            // 切换页面（active 状态由 switchPage 统一管理，避免和锁定状态冲突）
            const section = this.getAttribute('data-section');
            if (section) {
                switchPage(section);
            }

            // 关闭移动端导航
            navbarNav.classList.remove('active');
        });
    });
}

// 切换页面
/**
 * 等待下一帧，用于页面切换/跨页跳词时让浏览器先完成一帧渲染。
 * 当页面处于后台（document.hidden，如最小化、后台标签、失焦窗口）时 requestAnimationFrame 会被暂停，
 * 单纯 await rAF 会永久挂起、导致切换锁 isSwitching 不复位、所有页面切换失效；
 * 因此用 setTimeout 做兜底，前台仍由 rAF 在下一帧 resolve，时序不变。
 */
function nextFrame(): Promise<void> {
    return new Promise<void>(resolve => {
        let done = false;
        const fin = () => { if (!done) { done = true; resolve(); } };
        requestAnimationFrame(() => fin());
        setTimeout(fin, 120);
    });
}

export async function switchPage(section: string): Promise<void> {
    if (section === currentSection) return;
    if (isSwitching) {
        pendingSection = section as PageSection;
        return;
    }

    const targetPage = document.getElementById(`${section}-page`);
    if (!targetPage) return;

    isSwitching = true;
    try {
        // 导航栏同步更新
        const navLinks = document.querySelectorAll('.nav-link');
        navLinks.forEach(link => {
            link.classList.remove('active');
            if ((link as HTMLElement).dataset.section === section) {
                link.classList.add('active');
            }
        });

        const pages = document.querySelectorAll('.content-page');
        const prevActive = document.querySelector('.content-page.active');
        pages.forEach(page => page.classList.remove('active'));

        // 把刚离开的页面标记为已渲染，留在后台保持布局，下次切回不必重新 layout
        if (prevActive) {
            const prevSection = prevActive.id.replace('-page', '');
            // 离开测验页时中断未完成的单词本加载请求，避免阻塞后续切换
            if (prevSection === PageSection.Quiz) {
                pageHandlers.abortLoadWordbooks?.();
                pageHandlers.cleanupShowAnswerEnterHandler?.();
            }
            // 离开单词本页时中断选择器和单词列表渲染，并保存滚动位置
            if (prevSection === PageSection.Wordbook) {
                pageHandlers.saveWordbookScroll?.();
                pageHandlers.abortWordbookRendering?.();
            }
            prevActive.classList.add('rendered');
            // 更新 LRU 顺序
            renderedOrder = renderedOrder.filter(s => s !== prevSection);
            renderedOrder.push(prevSection);
            // 后台页面超过上限时释放最老的
            if (renderedOrder.length > MAX_RENDERED_PAGES) {
                releaseRenderedPages({ count: renderedOrder.length - MAX_RENDERED_PAGES });
            }
            // 触发页面离开回调
            pageHandlers.onPageLeave?.(prevSection);
            await nextFrame();
        }

        // 目标页若之前在后台，移除渲染记录
        const targetRenderedIndex = renderedOrder.indexOf(section);
        if (targetRenderedIndex >= 0) renderedOrder.splice(targetRenderedIndex, 1);
        targetPage.classList.remove('rendered');
        targetPage.classList.add('active');
        // currentSection 在页面入口 handler 前更新，避免 wordbook 等模块用 currentSection 判断时还是旧页面
        currentSection = section as PageSection;
        // 记录用户最后访问的页面，下次启动时恢复
        appState.lastVisitedPage = section;
        localStorage.setItem('lastVisitedPage', section);
        animatePageEnter(targetPage);

        // 触发页面进入/离开回调
        pageHandlers.onPageEnter?.(section);

        if (section === PageSection.Favorites) {
            pageHandlers.updateFavoritesDisplay?.();
        }
        else if (section === PageSection.Wordbook) {
            initWordbookAndErrorbookSearch();
            await pageHandlers.updateWordbookSelect?.();
            // 恢复上次选择的单词本，避免每次进入都重置为「我的收藏」
            const wordbookSelect = document.getElementById('wordbook-select') as HTMLSelectElement;
            if (wordbookSelect) {
                const targetValue = appState.lastSelectedWordbook &&
                    wordbookSelect.querySelector(`option[value="${appState.lastSelectedWordbook}"]`)
                    ? appState.lastSelectedWordbook : WordSource.Favorites;
                wordbookSelect.value = targetValue;
                appState.lastSelectedWordbook = targetValue;
                localStorage.setItem('lastSelectedWordbook', targetValue);
            }
            await pageHandlers.updateSelectedWordbookDisplay?.();
            pageHandlers.restoreWordbookScroll?.();
        }
        else if (section === PageSection.Errorbook) {
            initWordbookAndErrorbookSearch();
            pageHandlers.updateErrorbookDisplay?.();
        }
        else if (section === PageSection.Review) {
            initReviewPage();
        }
        else if (section === PageSection.Dictionary) {
            pageHandlers.showSearchHistory?.();
            // 从单词本页返回时，刷新词典页单词本下拉框
            pageHandlers.refreshResultWordbookSelector?.();
        }
        else if (section === PageSection.Quiz) {
            // 不阻塞页面切换，后台异步加载单词本；切出时会被 abort
            updateWordSourceSelector();
        }
    } finally {
        isSwitching = false;
        if (pendingSection && pendingSection !== currentSection) {
            const next = pendingSection;
            pendingSection = null;
            await switchPage(next);
        }
    }
}

/** Electron 内存告警时释放最久未访问的后台页面 */
function releaseRenderedPages(payload: { half?: boolean; count?: number } = {}): void {
    if (renderedOrder.length === 0) return;

    let releaseCount = payload.count ?? (payload.half ? Math.ceil(renderedOrder.length / 2) : renderedOrder.length);
    releaseCount = Math.min(releaseCount, renderedOrder.length);

    for (let i = 0; i < releaseCount; i++) {
        const oldSection = renderedOrder.shift();
        if (!oldSection) continue;
        const oldPage = document.getElementById(`${oldSection}-page`);
        if (oldPage) oldPage.classList.remove('rendered');
    }

    (window as any).electronAPI?.sendMemoryReleased?.(releaseCount);
}

// 监听主进程内存告警
(window as any).electronAPI?.onReleasePages?.(releaseRenderedPages);

// 更新单词来源选择器
export async function updateWordSourceSelector(): Promise<void> {
    const wordSourceSelect = document.getElementById('word-source') as HTMLSelectElement;
    if (!wordSourceSelect) return;

    // 确保单词本数据已加载
    await pageHandlers.loadWordbooks?.();

    // 复用 wordbook.ts 中的实现，包含共/已练习/未练习统计
    await refreshWordSourceSelect();

    // 恢复之前保存的设置
    const savedSource = appState.settings.wordSource;
    if (savedSource && wordSourceSelect.querySelector(`option[value="${savedSource}"]`)) {
        wordSourceSelect.value = savedSource;
        // 触发 change 让 word-source-display 同步刷新收起文本
        wordSourceSelect.dispatchEvent(new Event('change', { bubbles: true }));
    }
}

// 当前网络状态缓存
let isNetworkOnline: boolean | null = null;

/** 暂停所有进行中的下载任务 */
async function pauseAllDownloads(): Promise<void> {
    try {
        // 暂停数据资源下载
        await fetch('/api/assets/download/pause', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ assetId: 'all' })
        });
    } catch (e) {
        console.error('[network] 暂停资源下载失败:', e);
    }
    try {
        // 暂停发音批量下载
        await fetch('/api/pronunciations/download/pause', { method: 'POST' });
    } catch (e) {
        console.error('[network] 暂停发音下载失败:', e);
    }
}

// 初始化网络状态检测
export function initNetworkStatus(): void {
    const container = document.querySelector('.network-status') as HTMLElement;
    if (container) {
        container.addEventListener('click', () => {
            if (!container.classList.contains('checking')) {
                void checkNetworkStatus();
            }
        });
    }
    void checkNetworkStatus();
    window.addEventListener('offline', () => {
        updateNetworkUI(false, '离线');
        void handleNetworkChange(false);
    });
    window.addEventListener('online', () => {
        void checkNetworkStatus();
    });
    // 5 分钟低频兜底，防止系统事件丢失
    setInterval(() => void checkNetworkStatus(), 5 * 60 * 1000);
}

/** 网络状态变化时执行业务逻辑 */
async function handleNetworkChange(online: boolean): Promise<void> {
    if (isNetworkOnline === online) return;
    const previous = isNetworkOnline;
    isNetworkOnline = online;

    // 初始化首次检测时不弹窗，避免启动时多余提示
    if (previous === null) return;

    if (!online) {
        showToast('网络已断开，下载任务已自动暂停', 'error');
        await pauseAllDownloads();
    } else {
        showToast('网络已恢复', 'success');
    }
}

function updateNetworkUI(isOnline: boolean, text?: string, isChecking?: boolean): void {
    const indicator = document.getElementById('network-indicator');
    const statusText = document.getElementById('network-status-text');
    const container = document.querySelector('.network-status');

    if (container) {
        if (isChecking) {
            container.classList.add('checking');
        } else {
            container.classList.remove('checking');
        }
    }

    if (!indicator || !statusText) return;

    if (isChecking) {
        statusText.textContent = text || '检查中...';
        return;
    }

    if (isOnline) {
        indicator.classList.add('online');
        statusText.textContent = text || '在线';
    } else {
        indicator.classList.remove('online');
        statusText.textContent = text || '离线';
    }
}

export async function checkNetworkStatus(): Promise<void> {
    updateNetworkUI(false, '检查中...', true);
    try {
        const response = await fetch('/api/network/test', { cache: 'no-store' });
        const data = await response.json();
        const online = data.success && data.data && data.data.online;
        updateNetworkUI(online, online ? '在线' : '离线');
        await handleNetworkChange(online);
    } catch (error: unknown) {
        updateNetworkUI(false, '离线');
        await handleNetworkChange(false);
    }
}

// 各弹窗的焦点陷阱句柄：打开时建立、关闭时释放并把焦点还给触发元素
const modalTrapHandles = new WeakMap<HTMLElement, TrapHandle>();

export function openModal(modal: HTMLElement): void {
    modal.style.display = 'flex';
    modal.classList.remove('modal-visible');
    // 重复打开同一弹窗：先释放旧陷阱再重建
    modalTrapHandles.get(modal)?.release();
    modalTrapHandles.set(modal, trapFocus(modal));
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            modal.classList.add('modal-visible');
        });
    });
}

export function closeModal(modal: HTMLElement): void {
    modal.classList.remove('modal-visible');
    let done = false;
    const finish = () => {
        if (done) return;
        done = true;
        modal.style.display = 'none';
        modal.removeEventListener('transitionend', onEnd);
        const handle = modalTrapHandles.get(modal);
        if (handle) { handle.release(); modalTrapHandles.delete(modal); }
    };
    const onEnd = (e: TransitionEvent) => {
        if (e.target === modal && e.propertyName === 'opacity') {
            finish();
        }
    };
    modal.addEventListener('transitionend', onEnd);
    setTimeout(finish, 350);
}

// 活跃 confirm 的立即销毁句柄：重入（双击/重复触发）时正确关闭旧实例，避免悬挂 Promise 与监听器泄漏
let dismissActiveConfirm: ((result: boolean) => void) | null = null;

// 自定义确认弹窗，按钮文案为「是/否」，替代原生 confirm
export function showConfirm(message: string, title: string = '提示'): Promise<boolean> {
    return new Promise((resolve) => {
        if (dismissActiveConfirm) dismissActiveConfirm(false);

        const modalHtml = `
            <div id="custom-confirm-modal" class="modal-overlay custom-prompt-modal" style="position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 10000; display: flex; align-items: center; justify-content: center; opacity: 0;">
                <div class="modal-content" style="background: var(--bg-white); border-radius: var(--radius-modal); padding: 24px; width: 360px; max-width: 90%; box-shadow: 0 4px 20px rgba(0,0,0,0.15); transform: scale(0.92) translateY(10px); opacity: 0;">
                    <h3 style="margin: 0 0 12px 0; color: var(--text-dark); font-size: 16px;">${title}</h3>
                    <p style="margin: 0 0 20px 0; font-size: 14px; color: var(--text-gray); line-height: 1.6; white-space: pre-line;">${message}</p>
                    <div style="display: flex; gap: 12px; justify-content: flex-end;">
                        <button id="custom-confirm-yes" class="btn-modal-confirm" style="padding: 8px 20px;">是</button>
                        <button id="custom-confirm-no" class="btn-modal-cancel" style="padding: 8px 20px;">否</button>
                    </div>
                </div>
            </div>
        `;

        document.body.insertAdjacentHTML('beforeend', modalHtml);

        const modal = document.getElementById('custom-confirm-modal') as HTMLElement;
        const modalContent = modal.querySelector('.modal-content') as HTMLElement;
        const yesBtn = document.getElementById('custom-confirm-yes') as HTMLButtonElement;
        const noBtn = document.getElementById('custom-confirm-no') as HTMLButtonElement;

        // 焦点陷阱：Tab 循环在弹窗内，关闭后焦点回到触发元素
        const confirmTrap = trapFocus(modal, yesBtn);

        const keyHandler = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                document.removeEventListener('keydown', keyHandler);
                cleanup(false);
            } else if (e.key === 'Enter') {
                document.removeEventListener('keydown', keyHandler);
                cleanup(true);
            }
        };

        // 立即销毁（重入时由新实例调用）：无动画、立即移除并 resolve，释放陷阱与监听器
        const dismiss = (result: boolean) => {
            if (modal.dataset.dismissed) return;
            modal.dataset.dismissed = '1';
            document.removeEventListener('keydown', keyHandler);
            confirmTrap.release();
            modal.remove();
            resolve(result);
        };
        dismissActiveConfirm = dismiss;

        const cleanup = (result: boolean) => {
            if (modal.dataset.dismissed) return;
            modal.dataset.dismissed = '1';
            dismissActiveConfirm = null;
            document.removeEventListener('keydown', keyHandler);
            confirmTrap.release();
            closeModal(modal);
            setTimeout(() => {
                modal.remove();
                resolve(result);
            }, 350);
        };

        yesBtn.addEventListener('click', () => cleanup(true));
        noBtn.addEventListener('click', () => cleanup(false));

        document.addEventListener('keydown', keyHandler);

        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                modal.style.opacity = '1';
                modal.style.transition = 'opacity 0.25s ease';
                modalContent.style.transform = 'scale(1) translateY(0)';
                modalContent.style.opacity = '1';
                modalContent.style.transition = 'all 0.25s ease';
                yesBtn.focus();
            });
        });
    });
}

// 自定义提示弹窗，只有一个「知道了」按钮，替代原生 alert
let dismissActiveAlert: (() => void) | null = null;

export function showAlert(message: string, title: string = '提示'): Promise<void> {
    return new Promise((resolve) => {
        if (dismissActiveAlert) dismissActiveAlert();

        const modalHtml = `
            <div id="custom-alert-modal" class="modal-overlay custom-prompt-modal" style="position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 10000; display: flex; align-items: center; justify-content: center; opacity: 0;">
                <div class="modal-content" style="background: var(--bg-white); border-radius: var(--radius-modal); padding: 24px; width: 360px; max-width: 90%; box-shadow: 0 4px 20px rgba(0,0,0,0.15); transform: scale(0.92) translateY(10px); opacity: 0;">
                    <h3 style="margin: 0 0 12px 0; color: var(--text-dark); font-size: 16px;">${title}</h3>
                    <p style="margin: 0 0 20px 0; font-size: 14px; color: var(--text-gray); line-height: 1.6; white-space: pre-line;">${message}</p>
                    <div style="display: flex; gap: 12px; justify-content: flex-end;">
                        <button id="custom-alert-ok" class="btn-modal-confirm" style="padding: 8px 20px;">知道了</button>
                    </div>
                </div>
            </div>
        `;

        document.body.insertAdjacentHTML('beforeend', modalHtml);

        const modal = document.getElementById('custom-alert-modal') as HTMLElement;
        const modalContent = modal.querySelector('.modal-content') as HTMLElement;
        const okBtn = document.getElementById('custom-alert-ok') as HTMLButtonElement;

        const alertTrap = trapFocus(modal, okBtn);

        const keyHandler = (e: KeyboardEvent) => {
            if (e.key === 'Escape' || e.key === 'Enter') {
                document.removeEventListener('keydown', keyHandler);
                cleanup();
            }
        };

        const dismiss = () => {
            if (modal.dataset.dismissed) return;
            modal.dataset.dismissed = '1';
            document.removeEventListener('keydown', keyHandler);
            alertTrap.release();
            modal.remove();
            resolve();
        };
        dismissActiveAlert = dismiss;

        const cleanup = () => {
            if (modal.dataset.dismissed) return;
            modal.dataset.dismissed = '1';
            dismissActiveAlert = null;
            document.removeEventListener('keydown', keyHandler);
            alertTrap.release();
            closeModal(modal);
            setTimeout(() => {
                modal.remove();
                resolve();
            }, 350);
        };

        okBtn.addEventListener('click', cleanup);

        document.addEventListener('keydown', keyHandler);

        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                modal.style.opacity = '1';
                modal.style.transition = 'opacity 0.25s ease';
                modalContent.style.transform = 'scale(1) translateY(0)';
                modalContent.style.opacity = '1';
                modalContent.style.transition = 'all 0.25s ease';
                okBtn.focus();
            });
        });
    });
}

// 自定义输入弹窗，带一个输入框和「确定/取消」按钮，替代原生 prompt
let dismissActivePrompt: ((result: string | null) => void) | null = null;

export function showPrompt(message: string, defaultValue: string = '', title: string = '请输入'): Promise<string | null> {
    return new Promise((resolve) => {
        if (dismissActivePrompt) dismissActivePrompt(null);

        const modalHtml = `
            <div id="custom-prompt-modal" class="modal-overlay custom-prompt-modal" style="position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 10000; display: flex; align-items: center; justify-content: center; opacity: 0;">
                <div class="modal-content" style="background: var(--bg-white); border-radius: var(--radius-modal); padding: 24px; width: 360px; max-width: 90%; box-shadow: 0 4px 20px rgba(0,0,0,0.15); transform: scale(0.92) translateY(10px); opacity: 0;">
                    <h3 style="margin: 0 0 12px 0; color: var(--text-dark); font-size: 16px;">${title}</h3>
                    <p style="margin: 0 0 12px 0; font-size: 14px; color: var(--text-gray); line-height: 1.6; white-space: pre-line;">${message}</p>
                    <input id="custom-prompt-input" type="text" value="${escapeHtml(defaultValue)}" style="width: 100%; padding: 10px 12px; border: 1px solid var(--border-color); border-radius: 8px; font-size: 14px; box-sizing: border-box; margin-bottom: 20px; background: var(--bg-light); color: var(--text-dark);" />
                    <div style="display: flex; gap: 12px; justify-content: flex-end;">
                        <button id="custom-prompt-ok" class="btn-modal-confirm" style="padding: 8px 20px;">确定</button>
                        <button id="custom-prompt-cancel" class="btn-modal-cancel" style="padding: 8px 20px;">取消</button>
                    </div>
                </div>
            </div>
        `;

        document.body.insertAdjacentHTML('beforeend', modalHtml);

        const modal = document.getElementById('custom-prompt-modal') as HTMLElement;
        const modalContent = modal.querySelector('.modal-content') as HTMLElement;
        const input = document.getElementById('custom-prompt-input') as HTMLInputElement;
        const okBtn = document.getElementById('custom-prompt-ok') as HTMLButtonElement;
        const cancelBtn = document.getElementById('custom-prompt-cancel') as HTMLButtonElement;

        const promptTrap = trapFocus(modal, input);

        const keyHandler = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                document.removeEventListener('keydown', keyHandler);
                cleanup(null);
            } else if (e.key === 'Enter') {
                document.removeEventListener('keydown', keyHandler);
                cleanup(input.value.trim());
            }
        };

        const dismiss = (result: string | null) => {
            if (modal.dataset.dismissed) return;
            modal.dataset.dismissed = '1';
            document.removeEventListener('keydown', keyHandler);
            promptTrap.release();
            modal.remove();
            resolve(result);
        };
        dismissActivePrompt = dismiss;

        const cleanup = (result: string | null) => {
            if (modal.dataset.dismissed) return;
            modal.dataset.dismissed = '1';
            dismissActivePrompt = null;
            document.removeEventListener('keydown', keyHandler);
            promptTrap.release();
            closeModal(modal);
            setTimeout(() => {
                modal.remove();
                resolve(result);
            }, 350);
        };

        okBtn.addEventListener('click', () => cleanup(input.value.trim()));
        cancelBtn.addEventListener('click', () => cleanup(null));

        document.addEventListener('keydown', keyHandler);

        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                modal.style.opacity = '1';
                modal.style.transition = 'opacity 0.25s ease';
                modalContent.style.transform = 'scale(1) translateY(0)';
                modalContent.style.opacity = '1';
                modalContent.style.transition = 'all 0.25s ease';
                input.focus();
                input.select();
            });
        });
    });
}

export function initModalEscKey(): void {
    document.addEventListener('keydown', (e: KeyboardEvent) => {
        if (e.key !== 'Escape') return;
        const modals = document.querySelectorAll('.modal-overlay:not(.custom-prompt-modal)');
        let topModal: HTMLElement | null = null;
        let maxZIndex = -1;
        modals.forEach(modal => {
            const el = modal as HTMLElement;
            if (el.style.display === 'none') return;
            if (el.classList.contains('modal-visible') || el.style.display === 'flex') {
                const zIndex = parseInt(getComputedStyle(el).zIndex || '0', 10);
                if (zIndex > maxZIndex) {
                    maxZIndex = zIndex;
                    topModal = el;
                }
            }
        });
        if (topModal) {
            closeModal(topModal);
        }
    });

    document.addEventListener('click', (e: MouseEvent) => {
        const target = e.target as HTMLElement;
        if (target.classList.contains('modal-overlay') && !target.classList.contains('custom-prompt-modal')) {
            closeModal(target);
        }
    });
}

// 词跳转过渡
let wordJumpStart = 0;
let isCrossPageJump = false;
async function doWordJump(word: string, triggerSearch: () => void): Promise<void> {
    const result = document.getElementById('result');
    const searchInput = document.getElementById('search-input') as HTMLInputElement;
    if (searchInput) searchInput.value = word;

    const wasOnDict = currentSection === PageSection.Dictionary;
    if (result && result.classList.contains('result-visible') && wasOnDict) {
        result.classList.add('word-switching');
        wordJumpStart = performance.now();
        isCrossPageJump = false;
        triggerSearch();
    } else {
        wordJumpStart = performance.now();
        isCrossPageJump = true;
        // 跨页跳转前先隐藏结果区，避免切换过程中看到旧内容
        if (result) {
            result.classList.remove('result-visible');
            result.classList.remove('word-switching');
            result.style.opacity = '0';
        }
        await switchPage(PageSection.Dictionary);
        await nextFrame();
        await nextFrame();
        triggerSearch();
    }
}

export function isWordJumping(): boolean {
    return wordJumpStart > 0;
}

export function isCrossPageJumping(): boolean {
    return isCrossPageJump;
}

export function getWordJumpElapsed(): number {
    if (!wordJumpStart) return 0;
    return performance.now() - wordJumpStart;
}

export function onWordJumpDone(): void {
    wordJumpStart = 0;
    isCrossPageJump = false;
}

// 跳转到单词查询
export function jumpToWord(word: string): void {
    doWordJump(word, () => searchWord(word));
}

// 点击单词跳转到词典页面并查询
export function navigateToWord(word: string): void {
    doWordJump(word, () => {
        const searchButton = document.getElementById('search-button');
        if (searchButton) searchButton.click();
    });
}

// 初始化复习模式页面
let reviewPageInitialized = false;
export function initReviewPage(): void {
    const historySearch = document.getElementById('history-search') as HTMLInputElement;
    const historySearchBtn = document.getElementById('history-search-btn');

    if (!reviewPageInitialized) {
        if (historySearch) {
            historySearch.addEventListener('input', () => pageHandlers.showLearningHistory?.());
            historySearch.addEventListener('keyup', function(e: KeyboardEvent) {
                if (e.key === 'Enter') {
                    pageHandlers.showLearningHistory?.();
                }
            });
        }

        if (historySearchBtn) {
            historySearchBtn.addEventListener('click', () => pageHandlers.showLearningHistory?.());
        }
        reviewPageInitialized = true;
    }

    // 显示历史记录
    pageHandlers.showLearningHistory?.();
    // 初始化复习答题功能
    pageHandlers.initReviewQuiz?.();
}

// 初始化单词本和错题本搜索

export function initWordbookAndErrorbookSearch(): void {
    if (appState.wordbookSearchInitialized) return;

    // 初始化单词本搜索
    const wordbookSearch = document.getElementById('wordbook-search') as HTMLInputElement;
    const wordbookSearchBtn = document.getElementById('wordbook-search-btn');

    if (wordbookSearch) {
        wordbookSearch.addEventListener('input', () => pageHandlers.updateSelectedWordbookDisplay?.());
        wordbookSearch.addEventListener('keyup', function(e: KeyboardEvent) {
            if (e.key === 'Enter') {
                pageHandlers.updateSelectedWordbookDisplay?.();
            }
        });
    }

    if (wordbookSearchBtn) {
        wordbookSearchBtn.addEventListener('click', () => pageHandlers.updateSelectedWordbookDisplay?.());
    }

    // Vue组件内部处理虚拟滚动，无需额外监听

    // 初始化错题本搜索
    const errorbookSearch = document.getElementById('errorbook-search') as HTMLInputElement;
    const errorbookSearchBtn = document.getElementById('errorbook-search-btn');

    if (errorbookSearch) {
        errorbookSearch.addEventListener('input', () => pageHandlers.updateErrorbookDisplay?.());
        errorbookSearch.addEventListener('keyup', function(e: KeyboardEvent) {
            if (e.key === 'Enter') {
                pageHandlers.updateErrorbookDisplay?.();
            }
        });
    }

    if (errorbookSearchBtn) {
        errorbookSearchBtn.addEventListener('click', () => pageHandlers.updateErrorbookDisplay?.());
    }

    // 初始化收藏搜索
    const favoritesSearch = document.getElementById('favorites-search') as HTMLInputElement;
    const favoritesSearchBtn = document.getElementById('favorites-search-btn');

    if (favoritesSearch) {
        favoritesSearch.addEventListener('input', () => pageHandlers.updateFavoritesDisplay?.());
        favoritesSearch.addEventListener('keyup', function(e: KeyboardEvent) {
            if (e.key === 'Enter') {
                pageHandlers.updateFavoritesDisplay?.();
            }
        });
    }

    if (favoritesSearchBtn) {
        favoritesSearchBtn.addEventListener('click', () => pageHandlers.updateFavoritesDisplay?.());
    }

    // 初始化重命名按钮
    const renameBtn = document.getElementById('rename-wordbook');
    if (renameBtn) {
        renameBtn.addEventListener('click', function() {
            const selected = (document.getElementById('wordbook-select') as HTMLSelectElement).value;
            if (selected && selected.startsWith('sys_')) {
                void showAlert('系统单词本不能重命名');
                return;
            }
            if (selected === WordSource.Favorites || selected === WordSource.Errorbook) {
                void showAlert('收藏和错题本不能重命名');
                return;
            }
            if (selected && appState.wordbooks[selected]) {
                pageHandlers.renameWordbook?.(selected);
            }
        });
    }

    appState.wordbookSearchInitialized = true;
}

// 页面处理函数注册表（避免循环依赖）
// 由 main.ts 在各模块导入后注册
export const pageHandlers: {
    updateFavoritesDisplay?: () => void;
    updateErrorbookDisplay?: () => void;
    updateWordbookSelect?: () => void;
    updateSelectedWordbookDisplay?: () => void;
    showSearchHistory?: () => void;
    refreshResultWordbookSelector?: () => Promise<void>;
    renameWordbook?: (name: string) => void;
    loadWordbooks?: () => Promise<void>;
    abortLoadWordbooks?: () => void;
    abortWordbookRendering?: () => void;
    showLearningHistory?: () => void;
    initReviewQuiz?: () => void;
    cleanupShowAnswerEnterHandler?: () => void;
    saveWordbookScroll?: () => void;
    restoreWordbookScroll?: () => void;
    onPageEnter?: (page: string) => void;
    onPageLeave?: (page: string) => void;
} = {};

// 侧边栏折叠/展开

function setExpandBtnVisible(visible: boolean): void {
    if (visible) {
        document.body.classList.add('show-expand-btn');
    } else {
        document.body.classList.remove('show-expand-btn');
    }
}

let expandBtnHideTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleHideExpandBtn(delayMs: number): void {
    if (expandBtnHideTimer) clearTimeout(expandBtnHideTimer);
    expandBtnHideTimer = setTimeout(() => {
        setExpandBtnVisible(false);
        expandBtnHideTimer = null;
    }, delayMs);
}

function cancelHideExpandBtn(): void {
    if (expandBtnHideTimer) {
        clearTimeout(expandBtnHideTimer);
        expandBtnHideTimer = null;
    }
}

export function applySidebarCollapseState(): void {
    const collapsed = appState.sidebarCollapsed === true;
    const sidebar = document.getElementById('sidebar');
    const body = document.body;

    if (collapsed) {
        sidebar?.classList.add('collapsed');
        body.classList.add('sidebar-collapsed');
        // 刚折叠时显示按钮 3 秒，让用户知道它的位置
        setExpandBtnVisible(true);
        scheduleHideExpandBtn(3000);
    } else {
        sidebar?.classList.remove('collapsed');
        body.classList.remove('sidebar-collapsed');
        setExpandBtnVisible(false);
        cancelHideExpandBtn();
    }
}

export function toggleSidebarCollapse(): void {
    appState.sidebarCollapsed = !appState.sidebarCollapsed;
    applySidebarCollapseState();
}

export function initSidebarCollapse(): void {
    applySidebarCollapseState();

    const toggleBtn = document.getElementById('sidebar-toggle');
    const expandBtn = document.getElementById('sidebar-expand-btn');

    toggleBtn?.addEventListener('click', (e: MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        toggleSidebarCollapse();
    });

    expandBtn?.addEventListener('click', (e: MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        toggleSidebarCollapse();
    });

    // 鼠标靠近页面左侧 → 显示展开按钮；离开 → 渐隐（仅折叠态生效）
    const HOVER_TRIGGER_X = 60;   // 鼠标进入该 X 范围立即显示
    const HOVER_LEAVE_X = 120;     // 鼠标越过该 X 才隐藏（缓冲带，防抖动）
    const MOUSE_IDLE_MS = 1500;    // 鼠标静止在左侧 1.5 秒后渐隐

    let lastMouseX = 9999;
    let idleTimer: ReturnType<typeof setTimeout> | null = null;

    document.addEventListener('mousemove', (e: MouseEvent) => {
        if (!document.body.classList.contains('sidebar-collapsed')) return;

        const x = e.clientX;
        lastMouseX = x;

        if ((e.target as HTMLElement)?.closest?.('.sidebar-expand-btn')) {
            setExpandBtnVisible(true);
            cancelHideExpandBtn();
            return;
        }

        if (x <= HOVER_TRIGGER_X) {
            // 鼠标进入左侧触发区：显示
            setExpandBtnVisible(true);
            cancelHideExpandBtn();
            // 静止太久则自动隐藏
            if (idleTimer) clearTimeout(idleTimer);
            idleTimer = setTimeout(() => {
                if (lastMouseX <= HOVER_LEAVE_X) {
                    setExpandBtnVisible(false);
                }
            }, MOUSE_IDLE_MS);
        } else if (x >= HOVER_LEAVE_X) {
            // 离开缓冲带：300ms 后渐隐
            scheduleHideExpandBtn(300);
            if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
        }
        // HOVER_TRIGGER_X 与 HOVER_LEAVE_X 之间不切换状态，防抖动
    }, true);

    // 鼠标移出窗口：隐藏
    document.addEventListener('mouseleave', () => {
        if (!document.body.classList.contains('sidebar-collapsed')) return;
        scheduleHideExpandBtn(300);
    });

    // 鼠标回到窗口且在左侧：显示
    document.addEventListener('mouseenter', () => {
        if (!document.body.classList.contains('sidebar-collapsed')) return;
        if (lastMouseX <= HOVER_TRIGGER_X) {
            setExpandBtnVisible(true);
            scheduleHideExpandBtn(3000);
        }
    });
}