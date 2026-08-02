import {
    PronunciationType,
    QuizMode,
    QuizOrder,
    SortBy,
    FilterType,
    WordSource,
    ContentType,
    PageSection,
} from '../types/enums';

export type StorePath = (string | number)[];

export type StoreSubscriber = (path: StorePath, newValue: unknown, oldValue: unknown) => void;

// Vue 实例类型（简化版，仅包含需要的属性）
export interface VueInstance {
    setWordList: (...args: unknown[]) => void;
    $el: HTMLElement;
}

export interface AppState {
    // 主题
    isDarkMode: boolean;
    // 侧边栏折叠状态
    sidebarCollapsed: boolean;
    // 收藏夹（单词对象、字符串、句子对象混存）
    favorites: Array<WordData | string | { text: string; translation?: string; type?: string; timestamp?: number }>;
    // 自建单词本
    wordbooks: Record<string, WordbookItem[]>;
    // 错题本
    errorbook: Record<string, ErrorbookEntry>;
    // 听力卡壳词（识别/听写不出的词）
    listeningStuckWords: Record<string, ListeningStuckWord>;
    // 筛选/排序 UI 状态
    lastSelectedWordbook: string;
    lastWordbookSelector: string;
    lastVisitedPage: string;
    wordbookScrollTop: number;
    favoritesFilter: FilterType;
    favoritesSortBy: SortBy;
    errorbookSortBy: SortBy;
    errorbookFilter: FilterType;
    errorbookExpanded: Record<string, boolean>;
    wordbookFilter: FilterType;
    wordbookSortBy: SortBy;
    // 查词/测验运行时状态
    currentSearchWord: WordData | null;
    currentSentence: { text: string; translation: string } | null;
    currentQuizWord: WordData | null;
    currentQuizMeanings: Array<{ part: string; definition: string }>;
    currentQuizMode: QuizMode;
    quizWords: WordData[];
    errorCount: number;
    isWaitingForNextQuestion: boolean;
    isProcessingAnswer: boolean;
    isInInputCooldown: boolean;
    inputCooldownTimer: ReturnType<typeof setTimeout> | null;
    // 学习统计
    studyStats: StudyStatsData | null;
    // 设置（会持久化到 localStorage key=quizSettings）
    settings: {
        pronunciationType: PronunciationType;
        chineseCount: number;
        showAllMeanings: boolean;
        answerKey: string;
        playPronunciationKey: string;
        addToWordlistKey: string;
        addToFavoritesKey: string;
        addToFavoritesKeyInQuiz: string;
        addToErrorbookAfterShowAnswer: boolean;
        errorCorrectCount: number;
        autoPlayPronunciationAfterErrors: number;
        quizOrder: QuizOrder;
        quizWordCount: number;
        searchHistoryCount: number;
        enableEbbinghaus: boolean;
        quizMultiPartProbability: number;
        quizSinglePartProbability: number;
        dailyWordCount: number;
        soundEnabled: boolean;
        playbackRate: number;
        // 语义相似度模型开关：仅在「看英文写中文」(EnToZh) 模式下字符串匹配失败时启用本地模型兜底
        semanticSimilarityEnabled: boolean;
        quizMode?: QuizMode;
        wordSource?: WordSource;
        quizCount?: number;
    };
    // 组件实例（非持久化，仅作为引用挂载）
    wordbookVueInstance: VueInstance | null;
    favoritesVueInstance: VueInstance | null;
    errorbookVueInstance: VueInstance | null;
    wordbookSearchInitialized: boolean;
    // 临时标志
    [key: string]: unknown;
}

// 这些字段的值写入时会自动同步到 localStorage
// key 为持久化的 localStorage key，数组里的属性路径为需要同步的字段
const PERSISTENCE_MAP: Record<string, string[][]> = {
    'darkMode':          [['isDarkMode']],
    'sidebarCollapsed':  [['sidebarCollapsed']],
    'favorites':         [['favorites']],
    'wordbooks':         [['wordbooks']],
    'errorbook':         [['errorbook']],
    'listeningStuckWords': [['listeningStuckWords']],
    'lastSelectedWordbook':  [['lastSelectedWordbook']],
    'lastWordbookSelector':  [['lastWordbookSelector']],
    'lastVisitedPage':       [['lastVisitedPage']],
    'wordbookScrollTop':     [['wordbookScrollTop']],
    'favoritesFilter':   [['favoritesFilter']],
    'favoritesSortBy':   [['favoritesSortBy']],
    'errorbookSortBy':   [['errorbookSortBy']],
    'errorbookFilter':   [['errorbookFilter']],
    'wordbookFilter':    [['wordbookFilter']],
    'wordbookSortBy':    [['wordbookSortBy']],
    'studyStats':        [['studyStats']],
    'quizSettings':      [['settings']],
};

// 默认值（首次加载时使用）
function getDefaultState(): AppState {
    return {
        isDarkMode: false,
        sidebarCollapsed: false,
        favorites: [],
        wordbooks: {},
        errorbook: {},
        listeningStuckWords: {},
        lastSelectedWordbook: '',
        lastWordbookSelector: '',
        lastVisitedPage: '',
        wordbookScrollTop: 0,
        favoritesFilter: FilterType.All,
        favoritesSortBy: SortBy.Alphabetical,
        errorbookSortBy: SortBy.Frequency,
        errorbookFilter: FilterType.All,
        errorbookExpanded: {},
        wordbookFilter: FilterType.All,
        wordbookSortBy: SortBy.Alphabetical,
        currentSearchWord: null,
        currentSentence: null,
        studyStats: null,
        settings: {
            pronunciationType: PronunciationType.US,
            chineseCount: 1,
            showAllMeanings: false,
            answerKey: '1',
            playPronunciationKey: '2',
            addToWordlistKey: '1',
            addToFavoritesKey: '2',
            addToFavoritesKeyInQuiz: '3',
            addToErrorbookAfterShowAnswer: false,
            errorCorrectCount: 3,
            autoPlayPronunciationAfterErrors: 2,
            quizOrder: QuizOrder.Random,
            quizWordCount: 10,
            searchHistoryCount: 20,
            enableEbbinghaus: true,
            quizMultiPartProbability: 50,
            quizSinglePartProbability: 50,
            dailyWordCount: 20,
            soundEnabled: true,
            playbackRate: 1.0,
            semanticSimilarityEnabled: true,
        },
        quizWords: [],
        currentQuizWord: null,
        currentQuizMeanings: [],
        currentQuizMode: QuizMode.ZhToEn,
        errorCount: 0,
        isWaitingForNextQuestion: false,
        isProcessingAnswer: false,
        isInInputCooldown: false,
        inputCooldownTimer: null,
        wordbookVueInstance: null,
        favoritesVueInstance: null,
        errorbookVueInstance: null,
        wordbookSearchInitialized: false,
    };
}

function pathMatches(prefix: string[], target: string[]): boolean {
    if (prefix.length !== target.length) return false;
    for (let i = 0; i < prefix.length; i++) {
        if (String(prefix[i]) !== String(target[i])) return false;
    }
    return true;
}

// 判断某个路径是否应持久化，返回对应的 localStorage key（若有）
function getLocalStorageKeyForPath(path: StorePath): string | null {
    for (const storageKey of Object.keys(PERSISTENCE_MAP)) {
        const paths = PERSISTENCE_MAP[storageKey];
        for (const prefix of paths) {
            // 精确匹配（如 ['settings']）或前缀匹配（如 ['settings','xxx']）
            if (path.length >= prefix.length) {
                let match = true;
                for (let i = 0; i < prefix.length; i++) {
                    if (String(path[i]) !== String(prefix[i])) { match = false; break; }
                }
                if (match) return storageKey;
            }
        }
    }
    return null;
}

// 深拷贝（避免用户直接引用内部对象后意外修改）
function deepClone<T>(obj: T): T {
    if (obj === null || typeof obj !== 'object') return obj;
    if (Array.isArray(obj)) return obj.map(deepClone) as unknown as T;
    const out: any = {};
    for (const k of Object.keys(obj as any)) {
        out[k] = deepClone((obj as any)[k]);
    }
    return out;
}

const subscribers: Set<{ paths: string[][]; cb: StoreSubscriber }> = new Set();

function emitSubscribers(path: StorePath, newValue: any, oldValue: any): void {
    subscribers.forEach(sub => {
        // 若 paths 为空数组则订阅所有变化
        const matchAll = sub.paths.length === 0;
        const matchAny = sub.paths.some(prefix => {
            if (path.length < prefix.length) return false;
            for (let i = 0; i < prefix.length; i++) {
                if (String(path[i]) !== String(prefix[i])) return false;
            }
            return true;
        });
        if (matchAll || matchAny) {
            try {
                sub.cb(path, newValue, oldValue);
            } catch (err) {
                console.error('[store] subscriber error:', err);
            }
        }
    });
}

// WeakMap 记录哪些 plain object 已经被 Proxy 包装，避免重复包装
const proxyCache: WeakMap<object, object> = new WeakMap();

function createNestedProxy(target: any, path: StorePath): any {
    // 只对 plain object/array 做代理
    if (target === null || typeof target !== 'object') return target;
    if (target instanceof Date) return target;
    if (target instanceof RegExp) return target;
    if (typeof (target as any).nodeType !== 'undefined') return target; // DOM 节点不代理
    if (proxyCache.has(target)) return proxyCache.get(target);

    const proxy = new Proxy(target, {
        get(t: any, key: string | symbol, receiver: any): any {
            // 使用 Reflect.get 完成底层读取
            const raw = Reflect.get(t, key, receiver);
            if (typeof key === 'symbol') return raw;
            // 对对象/数组属性返回嵌套 Proxy，确保深层赋值也能被拦截
            if (raw !== null && typeof raw === 'object' && !Array.isArray(raw) && !isPlain(raw)) {
                return raw;
            }
            if (raw !== null && typeof raw === 'object') {
                return createNestedProxy(raw, [...path, String(key)]);
            }
            return raw;
        },

        set(t: any, key: string | symbol, value: any, receiver: any): boolean {
            if (typeof key === 'symbol') return Reflect.set(t, key, value, receiver);
            const fullPath = [...path, String(key)];
            const oldVal = Reflect.get(t, key, receiver);
            // 使用 Reflect.set 完成底层写入（先写，成功后再做持久化/通知）
            const success = Reflect.set(t, key, value, receiver);
            if (success) {
                // 只有在值真正变化时才通知（避免无意义的订阅回调）
                if (!shallowEqual(oldVal, value)) {
                    const storageKey = getLocalStorageKeyForPath(fullPath);
                    if (storageKey) persistToStorage(storageKey);
                    emitSubscribers(fullPath, value, oldVal);
                }
            }
            return success;
        },

        deleteProperty(t: any, key: string | symbol): boolean {
            if (typeof key === 'symbol') return Reflect.deleteProperty(t, key);
            const oldVal = (t as any)[key];
            const success = Reflect.deleteProperty(t, key);
            if (success) {
                const fullPath = [...path, String(key)];
                const storageKey = getLocalStorageKeyForPath(fullPath);
                if (storageKey) persistToStorage(storageKey);
                emitSubscribers(fullPath, undefined, oldVal);
            }
            return success;
        },
    });

    proxyCache.set(target, proxy);
    return proxy;
}

function isPlain(obj: object): boolean {
    if (!obj || typeof obj !== 'object') return false;
    if (Array.isArray(obj)) return false;
    if (obj instanceof Date) return false;
    if (obj instanceof RegExp) return false;
    const proto = Object.getPrototypeOf(obj);
    return proto === null || proto === Object.prototype;
}

function shallowEqual(a: any, b: any): boolean {
    if (a === b) return true;
    if (a === null || b === null) return false;
    if (typeof a !== 'object' || typeof b !== 'object') return false;
    if (Array.isArray(a) && Array.isArray(b)) {
        if (a.length !== b.length) return false;
        for (let i = 0; i < a.length; i++) {
            if (a[i] !== b[i]) return false;
        }
        return true;
    }
    if (Array.isArray(a) || Array.isArray(b)) return false;
    const keysA = Object.keys(a);
    const keysB = Object.keys(b);
    if (keysA.length !== keysB.length) return false;
    for (const key of keysA) {
        if (!Object.prototype.hasOwnProperty.call(b, key)) return false;
        if (a[key] !== b[key]) return false;
    }
    return true;
}

function readFromStorage<T>(key: string, fallback: T): T {
    try {
        const raw = localStorage.getItem(key);
        if (raw === null) return fallback;
        // 先尝试 JSON.parse；如果失败（例如值是普通字符串如 "favorites"），则直接返回
        try {
            return JSON.parse(raw) as T;
        } catch {
            return raw as unknown as T;
        }
    } catch (err) {
        console.warn(`[store] 读取 ${key} 失败：`, err);
        return fallback;
    }
}

function persistToStorage(key: string): void {
    try {
        // 从根 state 中取对应路径的值，再 JSON 写入
        let val: any = rawState;
        const paths = PERSISTENCE_MAP[key];
        // 一个 localStorage key 对应一个顶层路径（例如 settings → settings 字段）
        const topPath = paths?.[0] || [key];
        for (const p of topPath) val = val?.[p];
        localStorage.setItem(key, JSON.stringify(val));
    } catch (err) {
        console.warn(`[store] 写入 ${key} 失败：`, err);
    }
}

let rawState: AppState = getDefaultState();

function hydrate(): void {
    // 特殊字段：darkMode 为布尔字符串
    rawState.isDarkMode = localStorage.getItem('darkMode') === 'true';
    rawState.favorites = readFromStorage<any[]>('favorites', []);
    rawState.wordbooks = readFromStorage<Record<string, any[]>>('wordbooks', {});
    rawState.errorbook = readFromStorage<Record<string, any>>('errorbook', {});
    rawState.listeningStuckWords = readFromStorage<Record<string, ListeningStuckWord>>('listeningStuckWords', {});
    rawState.lastSelectedWordbook = readFromStorage<string>('lastSelectedWordbook', '');
    rawState.lastWordbookSelector = readFromStorage<string>('lastWordbookSelector', '');
    rawState.lastVisitedPage = readFromStorage<string>('lastVisitedPage', '');
    rawState.wordbookScrollTop = readFromStorage<number>('wordbookScrollTop', 0);
    rawState.favoritesFilter = readFromStorage<string>('favoritesFilter', FilterType.All) as FilterType;
    rawState.favoritesSortBy = readFromStorage<string>('favoritesSortBy', SortBy.Alphabetical) as SortBy;
    rawState.errorbookSortBy = readFromStorage<string>('errorbookSortBy', SortBy.Frequency) as SortBy;
    rawState.errorbookFilter = readFromStorage<string>('errorbookFilter', FilterType.All) as FilterType;
    rawState.wordbookFilter = readFromStorage<string>('wordbookFilter', FilterType.All) as FilterType;
    rawState.wordbookSortBy = readFromStorage<string>('wordbookSortBy', SortBy.Alphabetical) as SortBy;
    rawState.studyStats = readFromStorage<StudyStatsData | null>('studyStats', null);
    if (!rawState.studyStats || typeof rawState.studyStats !== 'object') {
        rawState.studyStats = {
            totalWords: 0,
            learnedCount: 0,
            searchCount: 0,
            studyDays: 0,
            todayWords: 0,
            errorWords: 0,
            lastStudyDate: new Date().toDateString(),
            tomorrowWords: 20,
            todaySeconds: 0,
            totalSeconds: 0,
        };
    } else {
        // 兼容旧数据：补全新字段
        if (typeof (rawState.studyStats as any).todaySeconds !== 'number') {
            (rawState.studyStats as any).todaySeconds = 0;
        }
        if (typeof (rawState.studyStats as any).totalSeconds !== 'number') {
            (rawState.studyStats as any).totalSeconds = 0;
        }
    }
    const savedSettings = readFromStorage<Partial<AppState['settings']>>('quizSettings', {});
    rawState.settings = { ...rawState.settings, ...savedSettings };
}

hydrate();

export const appState: AppState = createNestedProxy(rawState, []);

export interface StoreAPI {
    /** 读取状态（只读副本）—— 一般情况直接用 appState 属性即可 */
    snapshot(): AppState;
    /** 批量更新；newVal 为浅层合并到 rawState */
    patch(patchObj: Partial<AppState>): void;
    /** 重置为默认值（不写 localStorage，会触发订阅） */
    reset(): void;
    /** 订阅某路径（含子路径）下的变化，返回取消订阅函数 */
    subscribe(paths: string[][], cb: StoreSubscriber): () => void;
    /** 强制把当前状态写回 localStorage（用于迁移/初始化等场景） */
    flush(): void;
}

export const store: StoreAPI = {
    snapshot(): AppState {
        return deepClone(rawState);
    },
    patch(patchObj: Partial<AppState>): void {
        Object.keys(patchObj).forEach(key => {
            (appState as any)[key] = (patchObj as any)[key];
        });
    },
    reset(): void {
        const defaults = getDefaultState();
        // 先保留已有的 proxy 引用，清内容，再写回默认值
        Object.keys(rawState).forEach(key => {
            delete (rawState as any)[key];
        });
        Object.assign(rawState, defaults);
        // 触发订阅（广播 root 变化）
        emitSubscribers(['*'], rawState, null);
    },
    subscribe(paths: string[][], cb: StoreSubscriber): () => void {
        const entry = { paths, cb };
        subscribers.add(entry);
        return () => subscribers.delete(entry);
    },
    flush(): void {
        Object.keys(PERSISTENCE_MAP).forEach(persistToStorage);
    },
};

// 导出订阅便捷函数
export function subscribe(paths: string[][], cb: StoreSubscriber): () => void {
    return store.subscribe(paths, cb);
}

// 确保页面关闭前把状态写回（作为兜底）
if (typeof window !== 'undefined') {
    window.addEventListener('beforeunload', () => store.flush());
}

// 静默初始化一次持久化，确保首次打开时能读到本地缓存的状态