import {
    applyTheme,
    toggleTheme,
    setupNavbar,
    switchPage,
    initNetworkStatus,
    initWordbookAndErrorbookSearch,
    jumpToWord,
    navigateToWord,
    updateWordSourceSelector,
    pageHandlers,
    appState,
    initSidebarCollapse,
    openModal,
    closeModal,
    initModalEscKey,
} from './global';

import { initSearch, searchWord, initKeyboardShortcuts, translateText, showSearchHistory, removeFromSearchHistory, refreshResultWordbookSelector } from './modules/dictionary';
import { initQuiz, showLearningHistory, toggleHistoryDay, toggleDueWords, showDueWordsCondition, removeDueWord, toggleHistoryPanel, cleanupShowAnswerEnterHandler } from './modules/quiz';
import { initWordbookManagement, loadWordbooks, abortLoadWordbooks, abortWordbookRendering, renameWordbook, updateSelectedWordbookDisplay, updateWordbookSelect } from './modules/wordbook';
import { initSettings } from './modules/settings';
import { initStudyStats } from './modules/stats';
import { initReviewQuiz } from './modules/review';
import { updateFavoritesDisplay, removeFromFavorites, setFavoritesFilter, setFavoritesSort } from './modules/favorites';
import { updateErrorbookDisplay, removeFromErrorbook, setErrorbookFilter, setErrorbookSort } from './modules/errorbook';
import { setWordbookFilter, setWordbookSort, removeFromWordlist } from './modules/wordbook';
import { showImportFormat } from './modules/settings';
import { playPronunciation, playSentencePronunciation, setAppState } from './utils/audio';
import { initGsapAnimations, setupGsapGlobal } from './utils/gsap';

// 毛玻璃滚动降级（停止滚动 150ms 后恢复）
function initGlassScrollDegradation(): void {
    let isScrolling = false;
    let scrollTimer: ReturnType<typeof setTimeout> | null = null;

    function getActiveGlass(): NodeListOf<Element> {
        const activePage = document.querySelector('.content-page.active');
        return activePage ? activePage.querySelectorAll('.glass') : document.querySelectorAll('.glass');
    }

    window.addEventListener('scroll', () => {
        if (!isScrolling) {
            getActiveGlass().forEach(el => el.classList.add('glass-scroll'));
            isScrolling = true;
        }
        if (scrollTimer) clearTimeout(scrollTimer);
        scrollTimer = setTimeout(() => {
            getActiveGlass().forEach(el => el.classList.remove('glass-scroll'));
            isScrolling = false;
        }, 150);
    }, { passive: true });
}

// 全局函数注册表供动态 HTML 中的 onclick 调用
import { setupGlobalRegistry } from './global-registry';
setupGlobalRegistry({
    jumpToWord,
    navigateToWord,
    playPronunciation,
    playSentencePronunciation,
    switchPage,
    searchWord,
    translateText,
    showSearchHistory,
    selectSuggestion: null, // 在 initSearch 中动态设置
    removeFromFavorites,
    setFavoritesFilter,
    setFavoritesSort,
    removeFromErrorbook,
    setErrorbookFilter,
    setErrorbookSort,
    setWordbookFilter,
    setWordbookSort,
    removeFromWordlist,
    showImportFormat,
    removeFromSearchHistory,
    toggleHistoryDay,
    toggleDueWords,
    showDueWordsCondition,
    removeDueWord,
    toggleHistoryPanel,
});

// DOMContentLoaded 初始化
document.addEventListener('DOMContentLoaded', () => {
    console.log('拾词应用初始化中...');

    // 0. 注册页面处理函数（解决循环依赖）
    pageHandlers.updateFavoritesDisplay = updateFavoritesDisplay;
    pageHandlers.updateErrorbookDisplay = updateErrorbookDisplay;
    pageHandlers.updateSelectedWordbookDisplay = updateSelectedWordbookDisplay;
    pageHandlers.updateWordbookSelect = updateWordbookSelect;
    pageHandlers.showSearchHistory = showSearchHistory;
    pageHandlers.refreshResultWordbookSelector = refreshResultWordbookSelector;
    pageHandlers.renameWordbook = renameWordbook;
    pageHandlers.loadWordbooks = loadWordbooks;
    pageHandlers.abortLoadWordbooks = abortLoadWordbooks;
    pageHandlers.abortWordbookRendering = abortWordbookRendering;
    pageHandlers.showLearningHistory = showLearningHistory;
    pageHandlers.initReviewQuiz = initReviewQuiz;
    pageHandlers.cleanupShowAnswerEnterHandler = cleanupShowAnswerEnterHandler;

    // 0.5 注入 appState 到音频模块（供预加载使用）
    setAppState(appState);

    // 1. 应用主题
    applyTheme();

    // 1.5 毛玻璃滚动降级逻辑
    initGlassScrollDegradation();

    // 2. 初始化导航栏
    setupNavbar();

    // 3. 初始化网络状态检测
    initNetworkStatus();

    // 4. 初始化主题切换
    const themeToggle = document.getElementById('theme-toggle');
    if (themeToggle) {
        themeToggle.addEventListener('click', (e: MouseEvent) => {
            toggleTheme(e);
        });
    }

    // 5.5 初始化侧边栏折叠
    initSidebarCollapse();

    // 5.6 初始化ESC键关闭modal
    initModalEscKey();

    // 6. 初始化词典页面
    initSearch();
    initKeyboardShortcuts();

    // 7. 初始化测验页面
    initQuiz();

    // 8. 初始化单词本页面
    initWordbookManagement();

    // 9. 初始化设置页面
    initSettings();

    // 10. 初始化学习统计
    initStudyStats();

    // 11. 初始化单词本和错题本搜索
    initWordbookAndErrorbookSearch();

    // 12. 初始化收藏页面筛选/排序按钮
    initFavoritesFilterButtons();
    // 13. 初始化错题本页面筛选/排序按钮
    initErrorbookFilterButtons();
    // 14. 初始化单词本页面筛选/排序按钮
    initWordbookFilterButtons();

    // 14.5 同步筛选/排序按钮初始状态（根据localStorage恢复的值）
    syncFilterButtonStates();

    // 15. 初始化导入格式说明弹窗
    initImportFormatModal();

    // 16. 初始化艾宾浩斯说明弹窗
    initEbbinghausModal();

    // 16.5 初始化艾宾浩斯到期词加入条件弹窗
    initDueWordsConditionModal();

    // 17. 初始化导出选项
    initExportOptions();

    // 18. 初始化 GSAP 动效
    initGsapAnimations();
    setupGsapGlobal();

    // 19. 初始化使用说明弹窗
    initUsageGuide();

    console.log('拾词应用初始化完成');
});

// 辅助初始化函数

function initFavoritesFilterButtons(): void {
    const filterAll = document.getElementById('fav-filter-all');
    const filterWord = document.getElementById('fav-filter-word');
    const filterPhrase = document.getElementById('fav-filter-phrase');
    const filterSentence = document.getElementById('fav-filter-sentence');
    const sortAlpha = document.getElementById('fav-sort-alpha');
    const sortTime = document.getElementById('fav-sort-time');

    if (filterAll) filterAll.addEventListener('click', () => setFavoritesFilter('all'));
    if (filterWord) filterWord.addEventListener('click', () => setFavoritesFilter('word'));
    if (filterPhrase) filterPhrase.addEventListener('click', () => setFavoritesFilter('phrase'));
    if (filterSentence) filterSentence.addEventListener('click', () => setFavoritesFilter('sentence'));
    if (sortAlpha) sortAlpha.addEventListener('click', () => setFavoritesSort('alphabetical'));
    if (sortTime) sortTime.addEventListener('click', () => setFavoritesSort('time'));
}

function initErrorbookFilterButtons(): void {
    const filterAll = document.getElementById('err-filter-all');
    const filterWord = document.getElementById('err-filter-word');
    const filterPhrase = document.getElementById('err-filter-phrase');
    const filterSentence = document.getElementById('err-filter-sentence');
    const sortFreq = document.getElementById('err-sort-frequency');
    const sortAlpha = document.getElementById('err-sort-alpha');
    const sortTime = document.getElementById('err-sort-time');

    if (filterAll) filterAll.addEventListener('click', () => setErrorbookFilter('all'));
    if (filterWord) filterWord.addEventListener('click', () => setErrorbookFilter('word'));
    if (filterPhrase) filterPhrase.addEventListener('click', () => setErrorbookFilter('phrase'));
    if (filterSentence) filterSentence.addEventListener('click', () => setErrorbookFilter('sentence'));
    if (sortFreq) sortFreq.addEventListener('click', () => setErrorbookSort('frequency'));
    if (sortAlpha) sortAlpha.addEventListener('click', () => setErrorbookSort('alphabetical'));
    if (sortTime) sortTime.addEventListener('click', () => setErrorbookSort('time'));
}

function initWordbookFilterButtons(): void {
    const filterAll = document.getElementById('wordbook-filter-all');
    const filterWord = document.getElementById('wordbook-filter-word');
    const filterPhrase = document.getElementById('wordbook-filter-phrase');
    const filterSentence = document.getElementById('wordbook-filter-sentence');
    const sortAlpha = document.getElementById('wordbook-sort-alpha');
    const sortTime = document.getElementById('wordbook-sort-time');

    if (filterAll) filterAll.addEventListener('click', () => setWordbookFilter('all'));
    if (filterWord) filterWord.addEventListener('click', () => setWordbookFilter('word'));
    if (filterPhrase) filterPhrase.addEventListener('click', () => setWordbookFilter('phrase'));
    if (filterSentence) filterSentence.addEventListener('click', () => setWordbookFilter('sentence'));
    if (sortAlpha) sortAlpha.addEventListener('click', () => setWordbookSort('alphabetical'));
    if (sortTime) sortTime.addEventListener('click', () => setWordbookSort('time'));
}

function syncFilterButtonStates(): void {
    const favFilterMap: Record<string, string> = {
        'all': 'fav-filter-all', 'word': 'fav-filter-word',
        'phrase': 'fav-filter-phrase', 'sentence': 'fav-filter-sentence'
    };
    const favSortMap: Record<string, string> = {
        'alphabetical': 'fav-sort-alpha', 'time': 'fav-sort-time'
    };
    document.querySelectorAll('#favorites-page .filter-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('#favorites-page .sort-btn').forEach(b => b.classList.remove('active'));
    const favFilterBtn = document.getElementById(favFilterMap[appState.favoritesFilter] || 'fav-filter-all');
    const favSortBtn = document.getElementById(favSortMap[appState.favoritesSortBy] || 'fav-sort-alpha');
    if (favFilterBtn) favFilterBtn.classList.add('active');
    if (favSortBtn) favSortBtn.classList.add('active');

    const errFilterMap: Record<string, string> = {
        'all': 'err-filter-all', 'word': 'err-filter-word',
        'phrase': 'err-filter-phrase', 'sentence': 'err-filter-sentence'
    };
    const errSortMap: Record<string, string> = {
        'frequency': 'err-sort-frequency', 'alphabetical': 'err-sort-alpha', 'time': 'err-sort-time'
    };
    document.querySelectorAll('#errorbook-page .filter-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('#errorbook-page .sort-btn').forEach(b => b.classList.remove('active'));
    const errFilterBtn = document.getElementById(errFilterMap[appState.errorbookFilter] || 'err-filter-all');
    const errSortBtn = document.getElementById(errSortMap[appState.errorbookSortBy] || 'err-sort-frequency');
    if (errFilterBtn) errFilterBtn.classList.add('active');
    if (errSortBtn) errSortBtn.classList.add('active');

    const wbFilterMap: Record<string, string> = {
        'all': 'wordbook-filter-all', 'word': 'wordbook-filter-word',
        'phrase': 'wordbook-filter-phrase', 'sentence': 'wordbook-filter-sentence'
    };
    const wbSortMap: Record<string, string> = {
        'alphabetical': 'wordbook-sort-alpha', 'time': 'wordbook-sort-time'
    };
    document.querySelectorAll('#wordbook-page .filter-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('#wordbook-page .sort-btn').forEach(b => b.classList.remove('active'));
    const wbFilterBtn = document.getElementById(wbFilterMap[appState.wordbookFilter] || 'wordbook-filter-all');
    const wbSortBtn = document.getElementById(wbSortMap[appState.wordbookSortBy] || 'wordbook-sort-alpha');
    if (wbFilterBtn) wbFilterBtn.classList.add('active');
    if (wbSortBtn) wbSortBtn.classList.add('active');
}

function initImportFormatModal(): void {
    const showBtn = document.getElementById('show-import-format-btn');
    const modal = document.getElementById('import-format-modal');
    const closeBtn = document.getElementById('import-format-close');

    if (showBtn && modal) {
        showBtn.addEventListener('click', () => {
            showImportFormat();
        });
    }

    if (closeBtn && modal) {
        closeBtn.addEventListener('click', () => {
            closeModal(modal);
        });
    }

    if (modal) {
        modal.addEventListener('click', (e: MouseEvent) => {
            if (e.target === modal) {
                closeModal(modal);
            }
        });
    }
}

function initEbbinghausModal(): void {
    const infoLink = document.getElementById('ebbinghaus-info');
    const modal = document.getElementById('ebbinghaus-modal');
    const closeBtn = document.getElementById('ebbinghaus-close');

    if (infoLink && modal) {
        infoLink.addEventListener('click', (e: Event) => {
            e.preventDefault();
            openModal(modal);
        });
    }

    if (closeBtn && modal) {
        closeBtn.addEventListener('click', () => {
            closeModal(modal);
        });
    }

    if (modal) {
        modal.addEventListener('click', (e: MouseEvent) => {
            if (e.target === modal) {
                closeModal(modal);
            }
        });
    }
}

function initDueWordsConditionModal(): void {
    const modal = document.getElementById('due-words-condition-modal');
    const closeBtn = document.getElementById('due-words-condition-close');

    if (closeBtn && modal) {
        closeBtn.addEventListener('click', () => {
            closeModal(modal);
        });
    }

    if (modal) {
        modal.addEventListener('click', (e: MouseEvent) => {
            if (e.target === modal) {
                closeModal(modal);
            }
        });
    }
}

function initExportOptions(): void {
    const exportFormat = document.getElementById('export-format') as HTMLSelectElement;
    const exportMeaning = document.getElementById('export-meaning') as HTMLInputElement;
    const exportPhonetic = document.getElementById('export-phonetic') as HTMLInputElement;

    // 恢复上次的导出选项
    const savedFormat = localStorage.getItem('lastExportFormat');
    const savedMeaning = localStorage.getItem('lastExportMeaning');
    const savedPhonetic = localStorage.getItem('lastExportPhonetic');

    if (exportFormat && savedFormat) exportFormat.value = savedFormat;
    if (exportMeaning && savedMeaning !== null) exportMeaning.checked = savedMeaning === 'true';
    if (exportPhonetic && savedPhonetic !== null) exportPhonetic.checked = savedPhonetic === 'true';

    // 保存导出选项
    if (exportFormat) {
        exportFormat.addEventListener('change', () => {
            localStorage.setItem('lastExportFormat', exportFormat.value);
        });
    }
    if (exportMeaning) {
        exportMeaning.addEventListener('change', () => {
            localStorage.setItem('lastExportMeaning', String(exportMeaning.checked));
        });
    }
    if (exportPhonetic) {
        exportPhonetic.addEventListener('change', () => {
            localStorage.setItem('lastExportPhonetic', String(exportPhonetic.checked));
        });
    }
}

function initUsageGuide(): void {
    const modal = document.getElementById('usage-guide-modal') as HTMLElement;
    const closeBtn = document.getElementById('usage-guide-close') as HTMLElement;
    const okBtn = document.getElementById('usage-guide-ok') as HTMLElement;
    const helpTrigger = document.getElementById('help-trigger') as HTMLElement;
    const helpLogoImg = document.getElementById('help-logo-img') as HTMLElement;
    const noShowCheckbox = document.getElementById('usage-guide-noshow') as HTMLInputElement;
    const tabs = document.querySelectorAll('.usage-tab');
    const sections = document.querySelectorAll('.usage-section');

    if (!modal || !helpTrigger) return;

    const NOSHOW_KEY = 'usageGuideNoShow';
    const SEEN_KEY = 'usageGuideSeen';

    function switchTab(tabName: string): void {
        tabs.forEach(t => {
            if (t.getAttribute('data-tab') === tabName) {
                t.classList.add('active');
            } else {
                t.classList.remove('active');
            }
        });
        sections.forEach(s => {
            if (s.getAttribute('data-section') === tabName) {
                s.classList.add('active');
            } else {
                s.classList.remove('active');
            }
        });
    }

    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const tabName = tab.getAttribute('data-tab');
            if (tabName) switchTab(tabName);
        });
    });

    function openGuide(): void {
        const modalContent = modal.querySelector('.usage-guide-modal') as HTMLElement;
        if (modalContent) {
            modalContent.style.transform = '';
            modalContent.style.opacity = '';
            modalContent.style.transformOrigin = '';
            modalContent.style.transition = '';
        }
        modal.style.opacity = '';
        modal.style.transition = '';
        modal.classList.remove('shrinking-to-logo');
        modal.classList.remove('modal-visible');
        openModal(modal);

        if (!modalContent) return;

        const logoEl = helpLogoImg || helpTrigger;
        const logoRect = logoEl.getBoundingClientRect();
        const contentRect = modalContent.getBoundingClientRect();

        const logoCenterX = logoRect.left + logoRect.width / 2;
        const logoCenterY = logoRect.top + logoRect.height / 2;

        const originX = logoCenterX - contentRect.left;
        const originY = logoCenterY - contentRect.top;

        const startScale = Math.max(0.05, Math.min(logoRect.width, logoRect.height) / Math.max(contentRect.width, contentRect.height));

        modalContent.style.transformOrigin = `${originX}px ${originY}px`;
        modalContent.style.willChange = 'transform, opacity';
        modalContent.style.transform = '';

        const duration = 550;
        const easing = 'cubic-bezier(0.4, 0, 0.2, 1)';

        modal.animate(
            [
                { opacity: 0 },
                { opacity: 1 }
            ],
            { duration: duration - 50, easing: 'ease-out', fill: 'forwards' }
        );

        const contentAnim = modalContent.animate(
            [
                { transform: `scale(${startScale}) translateY(0px)`, opacity: 0 },
                { transform: 'scale(1) translateY(0px)', opacity: 1 }
            ],
            { duration, easing, fill: 'forwards' }
        );

        contentAnim.onfinish = () => {
            modalContent.style.transformOrigin = '';
            modalContent.style.willChange = '';
        };
    }

    function closeGuide(): void {
        if (modal.classList.contains('shrinking-to-logo')) return;

        localStorage.setItem(SEEN_KEY, 'true');
        if (noShowCheckbox && noShowCheckbox.checked) {
            localStorage.setItem(NOSHOW_KEY, 'true');
        }

        const modalContent = modal.querySelector('.usage-guide-modal') as HTMLElement;
        if (!modalContent) {
            closeModal(modal);
            return;
        }

        const logoEl = helpLogoImg || helpTrigger;
        const logoRect = logoEl.getBoundingClientRect();
        const contentRect = modalContent.getBoundingClientRect();

        const logoCenterX = logoRect.left + logoRect.width / 2;
        const logoCenterY = logoRect.top + logoRect.height / 2;

        const originX = logoCenterX - contentRect.left;
        const originY = logoCenterY - contentRect.top;

        const targetScale = Math.max(0.05, Math.min(logoRect.width, logoRect.height) / Math.max(contentRect.width, contentRect.height));

        modal.classList.add('shrinking-to-logo');

        modalContent.style.transformOrigin = `${originX}px ${originY}px`;
        modalContent.style.willChange = 'transform, opacity';
        modalContent.style.transform = '';

        const duration = 550;
        const easing = 'cubic-bezier(0.4, 0, 0.2, 1)';

        const overlayAnim = modal.animate(
            [
                { opacity: 1 },
                { opacity: 0 }
            ],
            { duration: duration - 50, easing: 'ease-in', fill: 'forwards' }
        );

        const contentAnim = modalContent.animate(
            [
                { transform: 'scale(1) translateY(0px)', opacity: 1 },
                { transform: `scale(${targetScale}) translateY(0px)`, opacity: 0 }
            ],
            { duration, easing, fill: 'forwards' }
        );

        let finished = false;
        const finish = () => {
            if (finished) return;
            finished = true;
            try { overlayAnim.cancel(); } catch {}
            try { contentAnim.cancel(); } catch {}
            modalContent.style.transform = '';
            modalContent.style.opacity = '';
            modalContent.style.transformOrigin = '';
            modalContent.style.willChange = '';
            modal.style.opacity = '';
            modal.classList.remove('shrinking-to-logo');
            modal.classList.remove('modal-visible');
            modal.style.display = 'none';
        };

        contentAnim.onfinish = finish;
        setTimeout(finish, duration + 100);
    }

    helpTrigger.addEventListener('click', (e: Event) => {
        e.preventDefault();
        e.stopPropagation();
        openGuide();
    });

    if (closeBtn) closeBtn.addEventListener('click', closeGuide);
    if (okBtn) okBtn.addEventListener('click', closeGuide);

    modal.addEventListener('click', (e: MouseEvent) => {
        if (e.target === modal) closeGuide();
    });

    const noShow = localStorage.getItem(NOSHOW_KEY) === 'true';

    if (!noShow) {
        setTimeout(() => {
            openGuide();
        }, 600);
    }
}