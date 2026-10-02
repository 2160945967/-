// GSAP 动效核心工具库
// 统一管理所有动画：卡片翻转、滚动联动、统计数字、交互反馈、主题切换

let gsapCore: any = null;
let gsapReady = false;
const pressedState = new WeakMap<HTMLElement, boolean>();

// 用户系统级"减少动态"偏好：JS 侧据此跳过波纹/大位移动画（CSS 侧 base.css 已有全局兜底）
export function prefersReducedMotion(): boolean {
    return typeof window !== 'undefined'
        && typeof window.matchMedia === 'function'
        && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

// 延迟加载 gsap，确保非阻塞
async function ensureGsap(): Promise<boolean> {
    if (gsapReady) return true;
    try {
        const mod = await import('gsap');
        gsapCore = mod.default || mod;
        gsapReady = true;
        return true;
    } catch {
        gsapReady = true; // 标记已尝试过，避免反复报错
        return false;
    }
}

// 页面初始化时就开始加载，需要用到时大概率已就绪
ensureGsap();

// 卡片翻转（测验/复习答题后反馈 + 单词详情卡）
export function animateCardFlip(cardEl: HTMLElement, flipped: boolean): void {
    if (!gsapCore || !cardEl) return;
    gsapCore.fromTo(cardEl,
        { rotateY: flipped ? 0 : 180 },
        { rotateY: flipped ? 180 : 0, duration: 0.35, ease: 'power2.out', clearProps: 'transform' }
    );
}

// 卡片入场动画（新增单词、列表渲染时）
export function animateCardEnter(el: HTMLElement | null): void {
    if (!gsapCore || !el) return;
    gsapCore.fromTo(el,
        { opacity: 0, y: 20, scale: 0.95 },
        { opacity: 1, y: 0, scale: 1, duration: 0.45, ease: 'back.out(1.3)', clearProps: 'opacity' }
    );
}

// 批量入场：带 stagger（交错）效果
export function animateCardsEnter(els: HTMLElement[]): void {
    if (!gsapCore || !els || els.length === 0) return;
    gsapCore.fromTo(els,
        { opacity: 0, y: 25, scale: 0.94 },
        {
            opacity: 1, y: 0, scale: 1,
            duration: 0.45,
            stagger: 0.05,
            ease: 'back.out(1.3)',
            clearProps: 'opacity, transform'
        }
    );
}

// 卡片退场动画（删除单词时平滑消失）
export function animateCardExit(el: HTMLElement, onDone?: () => void): void {
    if (!gsapCore || !el) {
        onDone?.();
        return;
    }
    gsapCore.to(el, {
        opacity: 0,
        x: '-120%',
        height: 0,
        margin: 0,
        padding: 0,
        duration: 0.4,
        ease: 'power2.in',
        onComplete: () => {
            el.remove();
            onDone?.();
        }
    });
}

// 全局轻提示 Toast（弹幕式，不阻塞交互）
const TOAST_ICONS: Record<string, string> = {
    success: '✓',
    error: '✕',
    warning: '⚠',
    info: 'ℹ',
};

const TOAST_COLORS: Record<string, string> = {
    success: '#10b981',
    error: '#ef4444',
    warning: '#f59e0b',
    info: '#3b82f6',
};

export function showToast(
    message: string,
    type: 'success' | 'error' | 'warning' | 'info' = 'info',
    duration: number = 2800
): HTMLElement {
    let container = document.getElementById('shici-toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'shici-toast-container';
        document.body.appendChild(container);
    }

    const el = document.createElement('div');
    el.className = `shici-toast shici-toast-${type}`;

    const icon = TOAST_ICONS[type] || TOAST_ICONS.info;
    const color = TOAST_COLORS[type] || TOAST_COLORS.info;

    el.innerHTML = `
        <span class="shici-toast-icon" style="color:${color}">${icon}</span>
        <span class="shici-toast-msg"></span>
        <button class="shici-toast-close" aria-label="关闭">✕</button>
    `;
    (el.querySelector('.shici-toast-msg') as HTMLElement).textContent = message;
    container.appendChild(el);

    const dismiss = () => {
        if (el.dataset.closed === '1') return;
        el.dataset.closed = '1';
        if (gsapCore) {
            gsapCore.to(el, {
                opacity: 0,
                y: -10,
                scale: 0.92,
                duration: 0.25,
                ease: 'power2.in',
                onComplete: () => el.remove()
            });
        } else {
            el.remove();
        }
    };

    const closeBtn = el.querySelector('.shici-toast-close') as HTMLButtonElement;
    if (closeBtn) {
        closeBtn.addEventListener('click', dismiss);
    }

    if (gsapCore) {
        gsapCore.fromTo(el,
            { opacity: 0, y: -20, scale: 0.92 },
            { opacity: 1, y: 0, scale: 1, duration: 0.3, ease: 'back.out(1.5)' }
        );
    } else {
        el.style.opacity = '1';
    }

    let hoverTimer: ReturnType<typeof setTimeout> | null = null;
    const timer = setTimeout(dismiss, duration);
    // 鼠标悬停时暂停自动关闭；移出后再进必须同时取消移出时挂的新定时器
    el.addEventListener('mouseenter', () => {
        clearTimeout(timer);
        if (hoverTimer) { clearTimeout(hoverTimer); hoverTimer = null; }
    });
    el.addEventListener('mouseleave', () => {
        hoverTimer = setTimeout(dismiss, Math.max(1000, duration / 2));
    });

    return el;
}

// 滚动联动动画（IntersectionObserver，兼容 + 高效）
export function initScrollAnimations(): void {
    const animatedSelectors = [
        '.wordlist-item',
        '.stat-card',
        '.setting-item',
        '.quiz-settings',
        '.history-item',
        '.related-words',
        '.word-detail'
    ];

    if ('IntersectionObserver' in window) {
        const observer = new IntersectionObserver((entries) => {
            if (!gsapCore) {
                entries.forEach(e => {
                    if (e.isIntersecting) {
                        (e.target as HTMLElement).style.opacity = '1';
                        observer.unobserve(e.target);
                    }
                });
                return;
            }
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const target = entry.target as HTMLElement;
                    gsapCore.fromTo(target,
                        { opacity: 0, y: 25 },
                        {
                            opacity: 1, y: 0, duration: 0.42, ease: 'power2.out', clearProps: 'opacity, transform'
                        }
                    );
                    observer.unobserve(target);
                }
            });
        }, { threshold: 0.08, rootMargin: '0px 0px -40px 0px' });

        // 延迟观察，避免首次渲染时被触发
        setTimeout(() => {
            document.querySelectorAll(animatedSelectors.join(',')).forEach(el => {
                if (!el.getAttribute('data-animated')) {
                    el.setAttribute('data-animated', '1');
                    observer.observe(el);
                }
            });
        }, 150);
    }
}

// 回到顶部按钮
export function initBackToTop(): void {
    if (document.getElementById('back-to-top')) return;
    const btn = document.createElement('button');
    btn.id = 'back-to-top';
    btn.innerHTML = '↑';
    btn.title = '回到顶部';
    btn.setAttribute('aria-label', '回到顶部');
    document.body.appendChild(btn);

    btn.addEventListener('click', () => {
        window.scrollTo({ top: 0, behavior: 'smooth' });
    });

    const updateVisibility = () => {
        const shouldShow = window.scrollY > 500;
        if (gsapCore) {
            gsapCore.to(btn, {
                opacity: shouldShow ? 1 : 0,
                pointerEvents: shouldShow ? 'auto' : 'none',
                y: shouldShow ? 0 : 10,
                duration: 0.3,
                ease: 'power2.out'
            });
        } else {
            btn.style.opacity = shouldShow ? '1' : '0';
            btn.style.pointerEvents = shouldShow ? 'auto' : 'none';
        }
    };

    // 用 requestAnimationFrame 节流
    let ticking = false;
    window.addEventListener('scroll', () => {
        if (!ticking) {
            requestAnimationFrame(() => {
                updateVisibility();
                ticking = false;
            });
            ticking = true;
        }
    }, { passive: true });
}

// 统计数字滚动动画
export function animateStatNumber(el: HTMLElement | null, targetVal: number): void {
    if (!el) return;
    if (!gsapCore) {
        el.textContent = targetVal.toString();
        return;
    }
    const current = parseInt(el.textContent || '0', 10) || 0;
    const obj = { val: current };
    gsapCore.to(obj, {
        val: targetVal,
        duration: 0.9,
        ease: 'power2.out',
        onUpdate: () => {
            el.textContent = Math.round(obj.val).toString();
        }
    });
}

// 弹性进度条动画
export function animateProgressBar(el: HTMLElement | null, percent: number): void {
    if (!el) return;
    if (gsapCore) {
        gsapCore.fromTo(el,
            { width: (el.offsetWidth / (el.parentElement?.offsetWidth || 1) * 100) + '%' },
            { width: percent + '%', duration: 0.7, ease: 'back.out(1.2)' }
        );
    } else {
        el.style.width = percent + '%';
    }
}

// 全局按钮点击反馈
// 行为：按下→缩小并保持；松开→回弹+触发原有点击；按下后移开按钮→本次交互作废

// 统一的"可点击元素"选择器：覆盖项目中所有主要可交互组件
const CLICKABLE_SELECTOR = [
    'button',
    'a.nav-link',
    '.favorites-btn',
    '.wordlist-btn',
    '.quiz-buttons button',
    '.wordbook-actions button',
    '#wordbook-search-btn',
    '#history-search-btn',
    '#errorbook-search-btn',
    '#favorites-search-btn',
    '#back-to-top',
    '#quiz-fav-btn',
    '#delete-wordbook',
    '#clear-stats',
    '#clear-cache',
    '#start-quiz',
    '#import-wordbook-btn',
    '#import-new-wordbook-btn',
    '#export-wordbook-btn',
    '#save-settings',
    '.sort-btn',
    '.theme-toggle',
    '.navbar-toggle',
    '.play-btn',
    '.remove-btn',
].join(',');

function getClickableTarget(target: EventTarget | null): HTMLElement | null {
    if (!(target instanceof Element)) return null;
    const el = target.closest(CLICKABLE_SELECTOR) as HTMLElement | null;
    if (!el || el.getAttribute('disabled') !== null || (el as HTMLButtonElement).disabled) return null;
    return el;
}

function pressDown(btn: HTMLElement): void {
    if (!gsapCore || !btn) return;
    pressedState.set(btn, true);
    gsapCore.to(btn, {
        scale: 0.95,
        duration: 0.1,
        ease: 'power2.in',
        overwrite: true
    });
}

function pressRelease(btn: HTMLElement): void {
    if (!gsapCore || !btn) return;
    pressedState.delete(btn);
    gsapCore.to(btn, {
        scale: 1,
        duration: 0.18,
        ease: 'back.out(2)',
        overwrite: true,
        onComplete: () => {
            btn.style.transform = '';
        }
    });
}

function pressCancel(btn: HTMLElement): void {
    if (!gsapCore || !btn) return;
    pressedState.set(btn, false); // 标记"本次交互作废"：即使稍后 pointerup 也不再回弹为有效点击
    gsapCore.to(btn, {
        scale: 1,
        duration: 0.18,
        ease: 'power2.out',
        overwrite: true,
        onComplete: () => {
            btn.style.transform = '';
        }
    });
}

export function initButtonFeedback(): void {
    if (!gsapCore) return;

    let pressedBtn: HTMLElement | null = null;

    document.body.addEventListener('pointerdown', (e) => {
        const btn = getClickableTarget(e.target);
        if (!btn) return;
        pressedBtn = btn;
        pressDown(btn);
    }, true);

    document.body.addEventListener('pointerup', (e) => {
        if (!pressedBtn) return;
        const btn = pressedBtn;
        pressedBtn = null;
        const elAtPoint = document.elementFromPoint(e.clientX, e.clientY);
        const stillOnBtn = elAtPoint && (elAtPoint === btn || btn.contains(elAtPoint));
        if (stillOnBtn) {
            pressRelease(btn);
        } else {
            pressCancel(btn);
        }
    }, true);

    document.body.addEventListener('pointercancel', () => {
        if (pressedBtn) {
            pressCancel(pressedBtn);
            pressedBtn = null;
        }
    }, true);
}

// 搜索框聚焦动画
export function initSearchBoxAnim(): void {
    if (!gsapCore) return;
    const inputs = document.querySelectorAll('.search-container input, #quiz-answer, #review-answer, #wordbook-search, #favorites-search, #errorbook-search, #history-search, #new-wordbook-name') as NodeListOf<HTMLElement>;
    inputs.forEach(input => {
        input.addEventListener('focus', () => {
            const container = input.closest('.search-container');
            if (container) return;
            gsapCore.to(input, { scale: 1.01, duration: 0.25, ease: 'power2.out', overwrite: true });
        });
        input.addEventListener('blur', () => {
            gsapCore.to(input, { scale: 1, duration: 0.25, ease: 'power2.out', overwrite: true });
        });
    });

    const selects = document.querySelectorAll('select') as NodeListOf<HTMLElement>;
    selects.forEach(sel => {
        sel.addEventListener('focus', () => {
            gsapCore.to(sel, { scale: 1.01, duration: 0.2, ease: 'power2.out', overwrite: true });
        });
        sel.addEventListener('blur', () => {
            gsapCore.to(sel, { scale: 1, duration: 0.2, ease: 'power2.out', overwrite: true });
        });
        sel.addEventListener('change', () => {
            gsapCore.fromTo(sel,
                { scale: 1.02 },
                { scale: 1, duration: 0.3, ease: 'back.out(2)', overwrite: true }
            );
        });
    });

    const searchContainers = document.querySelectorAll('.search-container') as NodeListOf<HTMLElement>;
    searchContainers.forEach(container => {
        const input = container.querySelector('input') as HTMLElement | null;
        if (!input) return;
        input.addEventListener('focus', () => {
            gsapCore.to(container, { y: -2, duration: 0.3, ease: 'power2.out', overwrite: true });
        });
        input.addEventListener('blur', () => {
            gsapCore.to(container, { y: 0, duration: 0.3, ease: 'power2.out', overwrite: true });
        });
    });
}

// 页面切换时h1标题下划线"生长"动画
export function animateHeadingUnderline(page: HTMLElement | null): void {
    if (!gsapCore || !page) return;
    const h1 = page.querySelector('h1');
    if (!h1) return;
    const after = { scaleX: 0 };
    gsapCore.to(after, {
        scaleX: 1,
        duration: 0.5,
        delay: 0.15,
        ease: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
        onUpdate: () => {
            h1.style.setProperty('--underline-scale', String(after.scaleX));
        }
    });
}

// 导航项hover光效（背景色块弹性滑动）
export function initNavHoverAnim(): void {
    if (!gsapCore) return;
    const navLinks = document.querySelectorAll('.nav-link') as NodeListOf<HTMLElement>;
    navLinks.forEach(link => {
        link.addEventListener('mouseenter', () => {
            if (link.classList.contains('active')) return;
            gsapCore.to(link, {
                y: -1,
                duration: 0.2,
                ease: 'power2.out',
                overwrite: true
            });
        });
        link.addEventListener('mouseleave', () => {
            gsapCore.to(link, {
                y: 0,
                duration: 0.2,
                ease: 'power2.out',
                overwrite: true
            });
        });
    });
}

// 侧边栏统计项hover弹性效果
export function initStatItemAnim(): void {
    if (!gsapCore) return;
    const items = document.querySelectorAll('.stat-item') as NodeListOf<HTMLElement>;
    items.forEach(item => {
        item.addEventListener('mouseenter', () => {
            gsapCore.to(item, {
                x: 6,
                duration: 0.3,
                ease: 'back.out(2)',
                overwrite: true
            });
        });
        item.addEventListener('mouseleave', () => {
            gsapCore.to(item, {
                x: 0,
                duration: 0.3,
                ease: 'power2.out',
                overwrite: true
            });
        });
    });
}

// filter/sort 按钮切换弹性反馈
export function initFilterBtnAnim(): void {
    if (!gsapCore) return;
    document.addEventListener('click', (e) => {
        const target = e.target as HTMLElement;
        if (!target) return;
        const btn = target.closest('.filter-btn, .sort-btn') as HTMLElement | null;
        if (!btn) return;
        gsapCore.fromTo(btn,
            { scale: 0.9 },
            { scale: 1, duration: 0.35, ease: 'back.out(2.5)', overwrite: true }
        );
    }, true);
}

// 搜索建议列表stagger入场
export function animateSuggestionsShow(container: HTMLElement): void {
    if (!gsapCore || !container) return;
    const items = container.children;
    if (items.length === 0) return;
    gsapCore.fromTo(items,
        { opacity: 0, y: -6, scaleX: 0.98 },
        {
            opacity: 1, y: 0, scaleX: 1,
            duration: 0.25,
            stagger: 0.025,
            ease: 'power2.out',
            clearProps: 'opacity, transform'
        }
    );
}

// 设置项hover微妙上浮效果
export function initSettingItemAnim(): void {
    if (!gsapCore) return;
    const items = document.querySelectorAll('.setting-item') as NodeListOf<HTMLElement>;
    items.forEach(item => {
        item.addEventListener('mouseenter', () => {
            if (item.classList.contains('is-dragging')) return;
            gsapCore.to(item, {
                y: -2,
                duration: 0.25,
                ease: 'power2.out',
                overwrite: true
            });
        });
        item.addEventListener('mouseleave', () => {
            gsapCore.to(item, {
                y: 0,
                duration: 0.25,
                ease: 'power2.out',
                overwrite: true
            });
        });
    });
}

// 单词卡片 hover 已统一由 CSS .wordlist-item:hover（translateY + 阴影）处理。
// 不再用 GSAP 写内联 transform：内联 transform 会覆盖 CSS hover，且旧实现只在初始化时
// 绑定一次，虚拟滚动动态生成的新卡片会失效；CSS 方案零监听、自动覆盖新卡、不掉帧。
export function initWordCardAnim(): void {
    // no-op：保留导出以兼容既有调用与 window.__gsapAnim 注册
}

// 结果区域出现时的动画（词典查询结果）
export function animateResultShow(el: HTMLElement | null): void {
    if (!gsapCore || !el) return;
    // 如果结果已经可见，做一次轻微脉冲即可，避免闪烁
    if (el.classList.contains('result-visible') && parseFloat(getComputedStyle(el).opacity) > 0.5) {
        gsapCore.fromTo(el,
            { opacity: 0.7, y: 6, scale: 0.995 },
            {
                opacity: 1, y: 0, scale: 1,
                duration: 0.28,
                ease: 'power2.out',
                clearProps: 'opacity, transform'
            }
        );
        return;
    }
    gsapCore.fromTo(el,
        { opacity: 0, y: 16, scale: 0.98 },
        {
            opacity: 1, y: 0, scale: 1,
            duration: 0.4,
            ease: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
            clearProps: 'opacity, transform'
        }
    );
}

// toast 通知/提示 按钮反馈（保存成功等）
export function animateSuccessPulse(el: HTMLElement | null): void {
    if (!gsapCore || !el) return;
    gsapCore.fromTo(el,
        { scale: 1 },
        {
            keyframes: [
                { scale: 0.92, duration: 0.08, ease: 'power2.in' },
                { scale: 1.06, duration: 0.15, ease: 'back.out(3)' },
                { scale: 1, duration: 0.2, ease: 'power2.out' }
            ]
        }
    );
}

// 侧边栏折叠按钮弹性
export function initSidebarToggleAnim(): void {
    if (!gsapCore) return;
    const toggle = document.getElementById('sidebar-toggle') as HTMLElement | null;
    const expand = document.getElementById('sidebar-expand-btn') as HTMLElement | null;
    [toggle, expand].forEach(btn => {
        if (!btn) return;
        btn.addEventListener('mouseenter', () => {
            gsapCore.to(btn, { scale: 1.1, duration: 0.2, ease: 'back.out(2)' });
        });
        btn.addEventListener('mouseleave', () => {
            gsapCore.to(btn, { scale: 1, duration: 0.2, ease: 'power2.out' });
        });
    });
}

// 主题切换按钮旋转
export function initThemeToggleAnim(): void {
    if (!gsapCore) return;
    const btn = document.getElementById('theme-toggle') as HTMLElement | null;
    if (!btn) return;
    btn.addEventListener('click', () => {
        gsapCore.fromTo(btn,
            { rotation: 0 },
            { rotation: 360, duration: 0.6, ease: 'power2.inOut', overwrite: true }
        );
    });
}

// 收藏/标记图标旋转弹跳动画
export function animateStarBounce(el: HTMLElement | null): void {
    if (!gsapCore || !el) return;
    gsapCore.fromTo(el,
        { rotate: -15, scale: 0.6, opacity: 0.6 },
        { rotate: 0, scale: 1, opacity: 1, duration: 0.45, ease: 'back.out(2.5)' }
    );
}

// 取消收藏的反向动画
export function animateStarUnbounce(el: HTMLElement | null, onDone?: () => void): void {
    if (!gsapCore || !el) {
        onDone?.();
        return;
    }
    gsapCore.to(el, {
        rotate: 15,
        scale: 0.7,
        opacity: 0,
        duration: 0.3,
        ease: 'power2.in',
        onComplete: () => {
            gsapCore.set(el, { rotate: 0, scale: 1, opacity: 1 });
            onDone?.();
        }
    });
}

// 区域/容器淡入 + 上移（用于搜索结果、释义区块等）
export function animateSectionIn(el: HTMLElement | null): void {
    if (!gsapCore || !el) return;
    gsapCore.fromTo(el,
        { opacity: 0, y: 12 },
        { opacity: 1, y: 0, duration: 0.4, ease: 'power2.out' }
    );
}

// 子项交错飞入（搜索历史、建议列表、例项列表等）
export function animateItemsStagger(selector: string): void {
    if (!gsapCore) return;
    const items = document.querySelectorAll(selector) as NodeListOf<HTMLElement>;
    if (items.length === 0) return;
    gsapCore.fromTo(items,
        { opacity: 0, y: 8 },
        { opacity: 1, y: 0, duration: 0.28, stagger: 0.03, ease: 'power2.out' }
    );
}

// 答题正确反馈
export function animateCorrectFeedback(el: HTMLElement | null): void {
    if (!gsapCore || !el) return;
    gsapCore.fromTo(el,
        { scale: 1 },
        {
            keyframes: [
                { scale: 1.08, duration: 0.15, ease: 'power2.out' },
                { scale: 0.96, duration: 0.12, ease: 'power2.in' },
                { scale: 1.03, duration: 0.12, ease: 'power2.out' },
                { scale: 1, duration: 0.15, ease: 'power2.out' }
            ]
        }
    );
}

// 答题错误抖动反馈
export function animateErrorShake(el: HTMLElement | null): void {
    if (!gsapCore || !el) return;
    gsapCore.fromTo(el,
        { x: 0 },
        {
            keyframes: [
                { x: -8, duration: 0.07 },
                { x: 8, duration: 0.07 },
                { x: -6, duration: 0.07 },
                { x: 6, duration: 0.07 },
                { x: -3, duration: 0.07 },
                { x: 0, duration: 0.07 }
            ],
            ease: 'power2.inOut'
        }
    );
}

// Toast / 提示淡入淡出
export function animateToastIn(el: HTMLElement | null): void {
    if (!gsapCore || !el) return;
    gsapCore.fromTo(el,
        { opacity: 0, y: 20, scale: 0.95 },
        { opacity: 1, y: 0, scale: 1, duration: 0.35, ease: 'back.out(1.4)' }
    );
}

export function animateToastOut(el: HTMLElement | null, onDone?: () => void): void {
    if (!gsapCore || !el) {
        onDone?.();
        return;
    }
    gsapCore.to(el, {
        opacity: 0,
        y: -10,
        scale: 0.95,
        duration: 0.25,
        ease: 'power2.in',
        onComplete: onDone
    });
}

// 强制重绘：修复 backdrop-filter 容器内 opacity 动画结束后子元素透明度不一致的 Chromium bug
function forceRepaint(el: HTMLElement): void {
    const prev = el.style.display;
    el.style.display = 'none';
    void el.offsetHeight;
    el.style.display = prev;
    void el.offsetHeight;
}

function forceRepaintDeep(el: HTMLElement): void {
    const selectors = [
        '.setting-item', '.wordlist-item', '.stat-item', '.history-item',
        '#result', '#quiz-container', '#review-quiz-container',
        '#quiz-question', '#review-question', '.quiz-option',
        '.word-detail', '.related-words', '.example-box',
        '.search-container', '#translation-container',
        '.stats-container', '.exam-category-card', '.network-status',
        '.modal-content', '.setting-desc', '.errorbook-sort-controls',
        '#search-history-items'
    ];
    const children = el.querySelectorAll(selectors.join(',')) as NodeListOf<HTMLElement>;
    children.forEach(child => {
        const prevDisplay = child.style.display;
        child.style.display = 'none';
        void child.offsetHeight;
        child.style.display = prevDisplay;
        void child.offsetHeight;
    });
    forceRepaint(el);
}

function forceRepaintDeepMultiFrame(el: HTMLElement, frames: number = 3): void {
    let count = 0;
    const tick = () => {
        forceRepaintDeep(el);
        count++;
        if (count < frames) {
            requestAnimationFrame(tick);
        }
    };
    requestAnimationFrame(tick);
}

export function animatePageEnter(page: HTMLElement | null): void {
    if (!gsapCore || !page) return;
    gsapCore.fromTo(page,
        { opacity: 0, y: 10, scale: 0.995 },
        {
            opacity: 1, y: 0, scale: 1,
            duration: 0.22,
            ease: 'power2.out',
            clearProps: 'opacity, transform',
            onComplete: () => {
                // 仅对页面本身做一次轻量重绘，避免对大量子元素逐帧 display 切换导致掉帧
                requestAnimationFrame(() => forceRepaint(page));
            }
        }
    );
}

// 供外部同步获取已加载的 gsap 实例（未加载时返回 null，调用方走 CSS 兜底）。
// 历史上 global.ts 读 (window as any).gsap，但 gsap 经动态 import('gsap') 存于本模块局部变量，
// 从未挂到 window，该读值永远为 undefined —— 此 getter 才是真实可用的引用。
export function getGsapCore(): any {
    return gsapCore;
}

// 供外部同步确保 GSAP 已加载（主题切换等需要即时动画的场景）
export async function loadGsap(): Promise<boolean> {
    return await ensureGsap();
}

// 统一初始化入口
export function initGsapAnimations(): void {
    if (!gsapCore) {
        ensureGsap().then(ok => {
            if (ok) doInit();
        });
    } else {
        doInit();
    }

    function doInit() {
        try {
            initScrollAnimations();
            initBackToTop();
            initButtonFeedback();
            initSearchBoxAnim();
            initNavHoverAnim();
            initStatItemAnim();
            initFilterBtnAnim();
            initSettingItemAnim();
            initSidebarToggleAnim();
            initThemeToggleAnim();
            // 单词卡片/搜索建议/滚动区域延迟观察
            setTimeout(() => {
                initWordCardAnim();
            }, 300);
        } catch (e) {
            // 静默失败，不影响核心功能
        }
    }
}

// 全局注册（供HTML内联 onclick 调用）
export function setupGsapGlobal(): void {
    (window as any).__gsapAnim = {
        animateCardFlip,
        animateCardEnter,
        animateCardsEnter,
        animateCardExit,
        animateStarBounce,
        animateStarUnbounce,
        animateCorrectFeedback,
        animateErrorShake,
        animateStatNumber,
        animateProgressBar,
        animateToastIn,
        animateToastOut,
        animateHeadingUnderline,
        animateSuggestionsShow,
        animateResultShow,
        animateSuccessPulse,
        animateSectionIn,
        animateItemsStagger,
        initWordCardAnim,
    };
}
