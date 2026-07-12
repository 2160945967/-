// Errorbook page: error list, filter, sort, weight display

import { appState, jumpToWord } from '../global';
import { updateStudyStats } from './stats';
import { SortBy, FilterType, ContentType } from '../types/enums';
import { normalizeCaseByType } from './wordbook';
import { playPronunciation } from '../utils/audio';
import { virtualScrollMixin } from '../utils/virtualScroll';
import { cardMixin } from '../utils/cardMixin';

let lastRenderSignature = '';

interface ErrorbookItem {
    word: string;
    type?: string;
    timestamp?: number;
    errorCount?: number;
    correctCount?: number;
    translation?: string;
    meanings?: Array<{ part: string; definition: string }>;
}

export function toggleErrorbookExpand(word: string): void {
    if (appState.errorbookExpanded[word]) {
        delete appState.errorbookExpanded[word];
    } else {
        appState.errorbookExpanded[word] = true;
    }
    updateErrorbookDisplay();
}

// 判断错题类型
export function getErrorbookItemType(item: unknown): string {
    if (item && typeof item === 'object' && (item as any).type) return (item as any).type;
    const text = typeof item === 'string' ? item : ((item as any).word || (item as any).text || '');
    const words = text.trim().split(/\s+/);
    if (words.length <= 1) return ContentType.Word;
    if (words.length > 5 || /[.!?;]/.test(text)) return ContentType.Sentence;
    return ContentType.Phrase;
}

export async function updateErrorbookDisplay(): Promise<void> {
    const errorbookEmpty = document.getElementById('errorbook-empty');
    const errorbookContent = document.getElementById('errorbook-content');

    if (!errorbookEmpty || !errorbookContent) return;

    errorbookContent.classList.add('errorbook-content-visible');

    let errorWords = Object.keys(appState.errorbook);

    // 类型筛选 - 使用统一的类型判断函数
    if (appState.errorbookFilter !== FilterType.All) {
        errorWords = errorWords.filter(word => getErrorbookItemType(word) === appState.errorbookFilter);
    }

    // 应用搜索过滤
    let searchKeyword = '';
    const errorbookSearch = document.getElementById('errorbook-search') as HTMLInputElement;
    if (errorbookSearch) {
        searchKeyword = errorbookSearch.value.trim().toLowerCase();
    }

    if (searchKeyword) {
        const key = searchKeyword.toLowerCase();
        const startsWithWords: string[] = [];
        const containsWords: string[] = [];

        errorWords.forEach(word => {
            const wordLower = word.toLowerCase();
            if (wordLower.startsWith(key)) startsWithWords.push(word);
            else if (wordLower.includes(key)) containsWords.push(word);
        });

        startsWithWords.sort((a, b) => a.localeCompare(b, 'en'));
        containsWords.sort((a, b) => a.localeCompare(b, 'en'));
        errorWords = [...startsWithWords, ...containsWords];
    }

    // 数据/筛选/搜索没变且 Vue 已挂载，直接复用已有渲染
    const renderSignature = `${Object.keys(appState.errorbook).length}|${appState.errorbookFilter}|${appState.errorbookSortBy}|${searchKeyword}`;
    if (renderSignature === lastRenderSignature && appState.errorbookVueInstance) return;
    lastRenderSignature = renderSignature;

    if (errorWords.length === 0) {
        errorbookEmpty.classList.add('empty-visible');
        errorbookEmpty.classList.remove('empty-hidden');
        return;
    }
    errorbookEmpty.classList.add('empty-hidden');
    errorbookEmpty.classList.remove('empty-visible');

    errorWords.sort((a, b) => {
        const dataA = appState.errorbook[a];
        const dataB = appState.errorbook[b];

        if (appState.errorbookSortBy === SortBy.Frequency) {
            let weightA = dataA.errorCount * 1.1;
            let weightB = dataB.errorCount * 1.1;

            if (dataA.meaningWeights && typeof dataA.meaningWeights === 'object') {
                weightA = Object.values(dataA.meaningWeights as Record<string, any>).reduce((sum: number, w: any) => sum + (w && typeof w.weight === 'number' ? w.weight : 0), 0);
            }
            if (dataB.meaningWeights && typeof dataB.meaningWeights === 'object') {
                weightB = Object.values(dataB.meaningWeights as Record<string, any>).reduce((sum: number, w: any) => sum + (w && typeof w.weight === 'number' ? w.weight : 0), 0);
            }
            return weightB - weightA;
        } else if (appState.errorbookSortBy === SortBy.Alphabetical) {
            return a.toLowerCase().localeCompare(b.toLowerCase());
        } else {
            return (dataB.addedTime || 0) - (dataA.addedTime || 0);
        }
    });

    // 使用Vue渲染
    initErrorbookVue();

    const vueItems = errorWords.map(word => {
        const errorData = appState.errorbook[word];
        return {
            word: word,
            type: getErrorbookItemType(word),
            timestamp: errorData.addedTime || 0,
            errorCount: errorData.errorCount || 0,
            correctCount: errorData.correctCount || 0,
            translation: '',
            meanings: []
        };
    });

    appState.errorbookVueInstance.setWordList(vueItems, appState.errorbook);
}

export function setErrorbookFilter(type: string): void {
    appState.errorbookFilter = type as FilterType;
    localStorage.setItem('errorbookFilter', type);

    document.querySelectorAll('#errorbook-page .filter-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    const btnMap: Record<string, string> = {
        'all': 'err-filter-all',
        'word': 'err-filter-word',
        'phrase': 'err-filter-phrase',
        'sentence': 'err-filter-sentence'
    };
    const targetBtn = document.getElementById(btnMap[type]);
    if (targetBtn) targetBtn.classList.add('active');

    updateErrorbookDisplay();
}

export function setErrorbookSort(sortBy: string): void {
    appState.errorbookSortBy = sortBy as SortBy;
    localStorage.setItem('errorbookSortBy', sortBy);

    const sortBtns = document.querySelectorAll('#errorbook-page .sort-btn');
    sortBtns.forEach(btn => {
        btn.classList.remove('active');
    });

    const btnMap: Record<string, string> = {
        'frequency': 'err-sort-frequency',
        'alphabetical': 'err-sort-alpha',
        'time': 'err-sort-time'
    };
    const targetBtn = document.getElementById(btnMap[sortBy]);
    if (targetBtn) targetBtn.classList.add('active');

    updateErrorbookDisplay();
}

// 从错题本移除单词
export function removeFromErrorbook(word: string): void {
    delete appState.errorbook[word];
    localStorage.setItem('errorbook', JSON.stringify(appState.errorbook));
    updateErrorbookDisplay();
    updateStudyStats();
}

// 错题本Vue组件
export function initErrorbookVue(): void {
    if (appState.errorbookVueInstance) return;

    const { createApp } = (window as any).Vue;

    const app = createApp({
        template: '#errorbook-vue-template',
        mixins: [virtualScrollMixin, cardMixin],
        data() {
            return {
                wordList: [] as ErrorbookItem[],
                itemHeights: {} as Record<string, number>,
                loadingHtml: '<p style="color: var(--accent-red); margin: 0;">正在加载释义...</p>',
                _errorbook: {} as Record<string, unknown>,
                _resizeObservers: {} as Record<string, ResizeObserver>,
            };
        },
        mounted() {
            this._resizeObservers = {};
        },
        beforeUnmount() {
            Object.values(this._resizeObservers).forEach(obs => (obs as ResizeObserver).disconnect());
            this._resizeObservers = {};
        },
        methods: {
            getMeaningsText(meanings: Array<{ part: string; definition: string }>) {
                if (!meanings || !Array.isArray(meanings)) return '';
                return meanings.map(m => {
                    let def = m.definition || '';
                    if (m.part && m.part.trim()) def = m.part.trim() + '. ' + def;
                    return def;
                }).join('; ');
            },
            errorInfo(word: string) {
                if (this._errorbook && this._errorbook[word]) {
                    const d = this._errorbook[word];
                    return `错误次数: ${d.errorCount}, 正确次数: ${d.correctCount}`;
                }
                return '';
            },
            measureWordHeight(word: string) {
                const root = this.$el as HTMLElement | null;
                const el = root ? root.querySelector(`[data-word="${CSS.escape(word)}"]`) as HTMLElement | null : null;

                // 清理旧的 ResizeObserver，避免元素被移除后继续回调
                if (this._resizeObservers[word]) {
                    this._resizeObservers[word].disconnect();
                    delete this._resizeObservers[word];
                }
                if (!el) return;

                const flipCard = el.querySelector('.flip-card') as HTMLElement | null;
                const back = el.querySelector('.flip-card-back') as HTMLElement | null;

                if (this.flippedMap[word] && back && flipCard) {
                    const originalBackHeight = back.style.height;
                    back.style.height = 'auto';
                    const backHeight = back.scrollHeight;
                    back.style.height = originalBackHeight;
                    flipCard.style.minHeight = backHeight + 'px';
                    back.style.alignItems = backHeight > this.collapsedHeight * 1.5 ? 'flex-start' : 'center';
                } else if (flipCard) {
                    flipCard.style.minHeight = '';
                    if (back) back.style.alignItems = '';
                }

                const updateHeight = () => {
                    const h = el!.offsetHeight + 20;
                    if (this.cachedHeights[word] !== h) {
                        this.cachedHeights[word] = h;
                        this.clearCache();
                    }
                };

                updateHeight();

                if (this.expandedMap[word] || this.flippedMap[word]) {
                    const observer = new ResizeObserver(() => updateHeight());
                    observer.observe(el);
                    this._resizeObservers[word] = observer;
                }
            },
            playPron(type: string, word: string) {
                playPronunciation(type, word);
            },
            removeWord(word: string) {
                this._animateWordRemoval(word, () => {
                    if (typeof removeFromErrorbook === 'function') removeFromErrorbook(word);
                    this.wordList = this.wordList.filter(item => item.word !== word);
                });
            },
            jumpToWord(word: string) {
                jumpToWord(word);
            },
            setWordList(words: ErrorbookItem[], errorbookData: Record<string, unknown>) {
                const wordSet = new Set(words.map(w => w.word));
                this.wordList = words.map(item => {
                    const type = item.type || getErrorbookItemType(item);
                    const displayWord = normalizeCaseByType(item.word);
                    return { ...item, type, displayWord };
                });
                this._errorbook = errorbookData;
                // 切页返回、筛选排序时保留展开/翻转状态和已加载释义；清理已不在列表中的单词缓存
                Object.keys(this.expandedMap).forEach(k => { if (!wordSet.has(k)) delete this.expandedMap[k]; });
                Object.keys(this.flippedMap).forEach(k => { if (!wordSet.has(k)) delete this.flippedMap[k]; });
                Object.keys(this.definitions).forEach(k => { if (!wordSet.has(k)) delete this.definitions[k]; });
                Object.keys(this.examples).forEach(k => { if (!wordSet.has(k)) delete this.examples[k]; });
                Object.keys(this.loadingDefinitions).forEach(k => { if (!wordSet.has(k)) delete this.loadingDefinitions[k]; });
                Object.keys(this.loadingExamples).forEach(k => { if (!wordSet.has(k)) delete this.loadingExamples[k]; });
                Object.keys(this.itemHeights).forEach(k => { if (!wordSet.has(k)) delete this.itemHeights[k]; });
                Object.keys(this.cachedHeights).forEach(k => { if (!wordSet.has(k)) delete this.cachedHeights[k]; });
                this.clearCache();

                // 切页返回后恢复翻转卡片的释义与高度
                this.$nextTick(() => {
                    Object.keys(this.flippedMap).forEach(word => {
                        if (!this.flippedMap[word]) return;
                        // 若切页前加载被中断导致 loading 标记卡住，先重置再重试
                        if (!this.definitions[word] || this.definitions[word] === this.loadingHtml) {
                            this.loadingDefinitions[word] = false;
                            this.loadDefinition(word);
                        }
                        if (!this.examples[word]) {
                            this.loadingExamples[word] = false;
                            this.loadExample(word);
                        }
                        this.measureWordHeight(word);
                    });
                    // 首次渲染后校正可见卡片高度，防止长词组导致虚拟滚动错位
                    setTimeout(() => this.measureVisibleHeights(), 50);
                });
            }
        },
    });

    appState.errorbookVueInstance = app.mount('#errorbook-vue-app');
}

