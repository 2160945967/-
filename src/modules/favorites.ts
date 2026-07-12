// Favorites page: favorites list, filter, sort, remove

import { appState, jumpToWord } from '../global';
import { updateStudyStats } from './stats';
import { getErrorbookItemType } from './errorbook';
import { normalizeCaseByType } from './wordbook';
import { SortBy, FilterType } from '../types/enums';
import { playPronunciation } from '../utils/audio';
import { virtualScrollMixin } from '../utils/virtualScroll';
import { cardMixin } from '../utils/cardMixin';

let lastRenderSignature = '';

interface FavoriteItem {
    word: string;
    type?: string;
    timestamp?: number;
    translation?: string;
    meanings?: Array<{ part: string; definition: string }>;
    text?: string;
}

export function getItemText(item: unknown): string {
    return typeof item === 'string' ? item : ((item as FavoriteItem).word || (item as FavoriteItem).text || '');
}

export function getItemTimestamp(item: unknown): number {
    if (item && typeof item === 'object' && (item as FavoriteItem).timestamp) return (item as FavoriteItem).timestamp;
    return 0;
}

export async function updateFavoritesDisplay(): Promise<void> {
    const favoritesEmpty = document.getElementById('favorites-empty');
    const favoritesContent = document.getElementById('favorites-content');

    if (!favoritesEmpty || !favoritesContent) return;

    favoritesContent.classList.add('favorites-content-visible');

    // 1. 获取收藏列表
    let items = [...appState.favorites];

    // 2. 类型筛选
    if (appState.favoritesFilter !== FilterType.All) {
        items = items.filter(item => getErrorbookItemType(item) === appState.favoritesFilter);
    }

    // 3. 排序
    if (appState.favoritesSortBy === SortBy.Alphabetical) {
        items.sort((a, b) => getItemText(a).toLowerCase().localeCompare(getItemText(b).toLowerCase(), 'en'));
    } else if (appState.favoritesSortBy === 'time') {
        items.sort((a, b) => getItemTimestamp(b) - getItemTimestamp(a));
    }

    // 4. 搜索过滤
    let searchKeyword = '';
    const favoritesSearch = document.getElementById('favorites-search') as HTMLInputElement;
    if (favoritesSearch) searchKeyword = favoritesSearch.value.trim().toLowerCase();

    if (searchKeyword) {
        const startsWithItems: typeof items = [];
        const containsItems: typeof items = [];
        items.forEach(item => {
            const textLower = getItemText(item).toLowerCase();
            if (textLower.startsWith(searchKeyword)) startsWithItems.push(item);
            else if (textLower.includes(searchKeyword)) containsItems.push(item);
        });
        startsWithItems.sort((a, b) => getItemText(a).localeCompare(getItemText(b), 'en'));
        containsItems.sort((a, b) => getItemText(a).localeCompare(getItemText(b), 'en'));
        items = [...startsWithItems, ...containsItems];
    }

    // 数据/筛选/搜索没变且 Vue 已挂载，直接复用已有渲染
    const renderSignature = `${appState.favorites.length}|${appState.favoritesFilter}|${appState.favoritesSortBy}|${searchKeyword}`;
    if (renderSignature === lastRenderSignature && appState.favoritesVueInstance) return;
    lastRenderSignature = renderSignature;

    // 5. 显示/隐藏空状态
    if (items.length === 0) {
        favoritesEmpty.classList.add('empty-visible');
        favoritesEmpty.classList.remove('empty-hidden');
    } else {
        favoritesEmpty.classList.add('empty-hidden');
        favoritesEmpty.classList.remove('empty-visible');
    }

    // 6. 使用Vue渲染
    initFavoritesVue();

    // 转换为Vue需要的格式
    const vueItems = items.map(item => {
        const text = getItemText(item);
        const type = getErrorbookItemType(item);

        let wordObj = {
            word: text,
            type: type,
            timestamp: getItemTimestamp(item),
            translation: (typeof item === 'object' && item !== null ? (item as any).translation : '') || '',
            meanings: (typeof item === 'object' && item !== null ? (item as any).meanings : []) || []
        };

        return wordObj;
    });

    appState.favoritesVueInstance.setWordList(vueItems);
}

export function setFavoritesFilter(type: string): void {
    appState.favoritesFilter = type as FilterType;
    localStorage.setItem('favoritesFilter', type);
    document.querySelectorAll('#favorites-page .filter-btn').forEach(btn => btn.classList.remove('active'));
    const btnMap: Record<string, string> = {
        'all': 'fav-filter-all',
        'word': 'fav-filter-word',
        'phrase': 'fav-filter-phrase',
        'sentence': 'fav-filter-sentence'
    };
    const targetBtn = document.getElementById(btnMap[type]);
    if (targetBtn) targetBtn.classList.add('active');
    updateFavoritesDisplay();
}

export function setFavoritesSort(sortBy: string): void {
    appState.favoritesSortBy = sortBy as SortBy;
    localStorage.setItem('favoritesSortBy', sortBy);
    document.querySelectorAll('#favorites-page .sort-btn').forEach(btn => btn.classList.remove('active'));
    const btnMap: Record<string, string> = {
        'alphabetical': 'fav-sort-alpha',
        'time': 'fav-sort-time'
    };
    const targetBtn = document.getElementById(btnMap[sortBy]);
    if (targetBtn) targetBtn.classList.add('active');
    updateFavoritesDisplay();
}

// 从收藏移除单词
export function removeFromFavorites(word: string): void {
    const filtered = appState.favorites.filter(item => {
        const itemWord = typeof item === 'string' ? item : (item as any).word || '';
        return itemWord !== word;
    });
    appState.favorites.length = 0;
    appState.favorites.push(...filtered);
    localStorage.setItem('favorites', JSON.stringify(appState.favorites));
    updateFavoritesDisplay();

    // 如果当前显示的是该单词，更新收藏按钮状态
    const currentWord = document.getElementById('word')?.textContent;
    if (currentWord === word) {
        const addToFavoritesBtn = document.getElementById('add-to-favorites');
        if (addToFavoritesBtn) {
            addToFavoritesBtn.classList.remove('active');
            addToFavoritesBtn.textContent = '加入收藏';
        }
    }
}

// 从收藏移除句子（通过 text 字段匹配）
export function removeFromFavoritesSentence(text: string): void {
    const filtered = appState.favorites.filter(item => {
        const itemText = typeof item === 'string' ? item : ((item as FavoriteItem).word || (item as FavoriteItem).text);
        return itemText !== text;
    });
    appState.favorites.length = 0;
    appState.favorites.push(...filtered);
    localStorage.setItem('favorites', JSON.stringify(appState.favorites));
    updateFavoritesDisplay();
}

// 收藏页面Vue组件
export function initFavoritesVue(): void {
    if (appState.favoritesVueInstance) return;

    const { createApp } = (window as any).Vue;

    const app = createApp({
        template: '#favorites-vue-template',
        mixins: [virtualScrollMixin, cardMixin],
        data() {
            return {
                wordList: [] as FavoriteItem[],
                itemHeights: {} as Record<string, number>,
            };
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
            playPron(type: string, word: string) {
                playPronunciation(type, word);
            },
            removeWord(word: string) {
                this._animateWordRemoval(word, () => {
                    if (typeof removeFromFavorites === 'function') removeFromFavorites(word);
                    this.wordList = this.wordList.filter(item => item.word !== word);
                });
            },
            jumpToWord(word: string) {
                jumpToWord(word);
            },
            setWordList(words: FavoriteItem[]) {
                const wordSet = new Set(words.map(w => w.word));
                this.wordList = words.map(item => {
                    const type = item.type || getErrorbookItemType(item);
                    const displayWord = normalizeCaseByType(item.word);
                    return { ...item, type, displayWord };
                });
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

    appState.favoritesVueInstance = app.mount('#favorites-vue-app');
}