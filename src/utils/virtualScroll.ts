// 虚拟列表通用 Mixin — 供 wordbook/favorites/errorbook Vue 组件复用
// 使用方式：在 Vue 组件定义中加入 mixins: [virtualScrollMixin]
// 组件需额外提供：wordList, collapsedHeight, expandedMap, flippedMap, cachedHeights

import { VIRTUAL_SCROLL_BUFFER, COLLAPSED_HEIGHT } from '../constants';

export const virtualScrollMixin = {
    data() {
        return {
            scrollTop: 0,
            containerHeight: 600,
            BUFFER: VIRTUAL_SCROLL_BUFFER,
            collapsedHeight: COLLAPSED_HEIGHT,
            _offsetCache: {} as Record<number, number>,
            _rafId: 0,
            _pendingScrollTop: 0 as number,
            _resizeObserver: null as ResizeObserver | null,
            _lastTotalHeight: 0,
        };
    },
    computed: {
        offsets() {
            const { start, end } = (this as any).visibleRange;
            const cache = (this as any)._offsetCache;
            const len = (this as any).wordList.length;
            let anchorIdx = -1;
            let anchorOffset = 0;
            for (let i = start; i >= 0; i -= 20) {
                if (cache[i] !== undefined) {
                    anchorIdx = i;
                    anchorOffset = cache[i];
                    break;
                }
            }
            if (anchorIdx < 0) { anchorIdx = 0; anchorOffset = 0; }
            for (let i = anchorIdx + 1; i <= start; i++) {
                anchorOffset += (this as any).getHeight(i);
            }
            const arr: number[] = [];
            for (let i = start; i < end && i < len; i++) {
                arr.push(anchorOffset);
                cache[i] = anchorOffset;
                anchorOffset += (this as any).getHeight(i);
            }
            return arr;
        },
        totalHeight() {
            const len = (this as any).wordList.length;
            if (len === 0) return 0;
            const cache = (this as any)._offsetCache;
            let baseIdx = -1;
            let baseOffset = 0;
            for (let i = len - 1; i >= Math.max(0, len - 200); i--) {
                if (cache[i] !== undefined) {
                    baseIdx = i;
                    baseOffset = cache[i];
                    break;
                }
            }
            if (baseIdx < 0) {
                for (let i = 0; i < len; i++) {
                    baseOffset += (this as any).getHeight(i);
                }
            } else {
                for (let i = baseIdx; i < len; i++) {
                    baseOffset += (this as any).getHeight(i);
                }
            }
            (this as any)._lastTotalHeight = baseOffset;
            return baseOffset;
        },
        visibleRange() {
            const cache = (this as any)._offsetCache;
            const len = (this as any).wordList.length;
            const collapsedH = (this as any).collapsedHeight;
            const viewTop = (this as any).scrollTop;
            const viewBottom = viewTop + (this as any).containerHeight;
            const bufferPx = (this as any).BUFFER * collapsedH;
            let start = 0;
            let low = 0, high = len - 1;
            while (low <= high) {
                const mid = (low + high) >> 1;
                const estOffset = cache[mid] ?? mid * collapsedH;
                const estBottom = estOffset + collapsedH * 2;
                if (estBottom < viewTop - bufferPx) {
                    start = mid + 1;
                    low = mid + 1;
                } else {
                    high = mid - 1;
                }
            }
            start = Math.max(0, start - (this as any).BUFFER);
            let end = len;
            let curOffset = cache[start] ?? start * collapsedH;
            for (let i = start; i < len; i++) {
                if (i > start) curOffset += (this as any).getHeight(i);
                if (curOffset > viewBottom + bufferPx) {
                    end = i;
                    break;
                }
            }
            end = Math.min(len, end + (this as any).BUFFER);
            return { start, end };
        },
        visibleItems() {
            const { start, end } = (this as any).visibleRange;
            if (start >= end) return [];
            return (this as any).wordList.slice(start, end).map((item: any, i: number) => ({
                ...item,
                _idx: start + i,
            }));
        },
    },
    methods: {
        getHeight(index: number) {
            const word = (this as any).wordList[index]?.word;
            if (((this as any).expandedMap[word] || (this as any).flippedMap[word])) {
                if ((this as any).cachedHeights[word]) {
                    return (this as any).cachedHeights[word];
                }
                // 初始估算不要太大，实际高度由 measureWordHeight 尽快修正
                return (this as any).collapsedHeight * 2;
            }
            return (this as any).collapsedHeight;
        },
        getItemStyle(idx: number) {
            const word = (this as any).wordList[idx]?.word;
            const { start } = (this as any).visibleRange;
            const relIdx = Math.max(0, idx - start);
            return {
                position: 'absolute',
                top: (this as any).offsets[relIdx] + 'px',
                left: 0,
                right: 0,
                height: 'auto',
                zIndex: ((this as any).expandedMap[word] || (this as any).flippedMap[word]) ? 10 : 1,
                cursor: 'pointer',
            };
        },
        onScroll(e: Event) {
            const target = (e.target as HTMLElement).scrollTop;
            (this as any)._pendingScrollTop = target;
            if ((this as any)._rafId) return;
            (this as any)._rafId = requestAnimationFrame(() => {
                (this as any).scrollTop = (this as any)._pendingScrollTop;
                (this as any)._rafId = 0;
            });
        },
        updateContainerHeight() {
            const el = (this as any).$el as HTMLElement;
            if (el) {
                (this as any).containerHeight = el.clientHeight || 600;
            }
        },
        clearCache() {
            (this as any)._offsetCache = {};
            (this as any)._lastTotalHeight = 0;
        },
        setWordList(words: any[], keepScroll?: boolean) {
            if (!keepScroll) {
                (this as any).scrollTop = 0;
                (this as any)._pendingScrollTop = 0;
            }
            (this as any).wordList = words;
            (this as any).clearCache();
        },
    },
    mounted() {
        (this as any).$nextTick(() => {
            (this as any).updateContainerHeight();
        });
        (this as any)._resizeObserver = new ResizeObserver(() => {
            (this as any).updateContainerHeight();
        });
        const el = (this as any).$el as HTMLElement;
        if (el && el.parentElement) {
            (this as any)._resizeObserver.observe(el.parentElement);
        }
    },
    beforeUnmount() {
        if ((this as any)._resizeObserver) {
            (this as any)._resizeObserver.disconnect();
        }
    },
};