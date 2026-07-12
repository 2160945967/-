type Fn = (...args: unknown[]) => void;

interface Registry {
    jumpToWord: Fn;
    navigateToWord: Fn;
    playPronunciation: Fn;
    playSentencePronunciation: Fn;
    switchPage: Fn;
    searchWord: Fn;
    translateText: Fn;
    showSearchHistory: Fn;
    selectSuggestion: Fn | null;
    removeFromFavorites: Fn;
    setFavoritesFilter: Fn;
    setFavoritesSort: Fn;
    removeFromErrorbook: Fn;
    setErrorbookFilter: Fn;
    setErrorbookSort: Fn;
    setWordbookFilter: Fn;
    setWordbookSort: Fn;
    removeFromWordlist: Fn;
    showImportFormat: Fn;
    removeFromSearchHistory: Fn | null;
    toggleHistoryDay: Fn;
    toggleDueWords: Fn;
    showDueWordsCondition: Fn;
    removeDueWord: Fn;
    toggleHistoryPanel: Fn;
}

const registry: Partial<Registry> = {};

export function setupGlobalRegistry(functions: Partial<Registry>): void {
    Object.assign(registry, functions);
}

export function getRegistry(): Partial<Registry> {
    return registry;
}

(window as unknown as Record<string, unknown>).g = function(name: string, ...args: unknown[]): void {
    const fn = registry[name as keyof Registry];
    if (typeof fn === 'function') {
        fn(...args);
    } else {
        console.warn(`[global-registry] 函数 ${name} 未注册`);
    }
};
