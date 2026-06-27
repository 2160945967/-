// 卡片翻转/展开/释义/例句等共享逻辑，供 wordbook/favorites/errorbook Vue 组件复用
import { animateCardFlip, animateCardExit } from './gsap';
import { apiTranslate } from './api';
import { buildTranslationHtml } from './translation';

export const cardMixin = {
    data() {
        return {
            expandedMap: {} as Record<string, boolean>,
            flippedMap: {} as Record<string, boolean>,
            definitions: {} as Record<string, string>,
            examples: {} as Record<string, string>,
            loadingDefinitions: {} as Record<string, boolean>,
            loadingExamples: {} as Record<string, boolean>,
            cachedHeights: {} as Record<string, number>,
            collapsedHeight: 140,
            loadingHtml: '<p style="color: var(--primary-blue); margin: 0;">正在加载释义...</p>',
        };
    },
    methods: {
        handleLeftClick(word: string) {
            const cardEl = document.querySelector(`[data-word="${CSS.escape(word)}"] .flip-card`) as HTMLElement | null;
            if ((this as any).flippedMap[word]) {
                (this as any).flippedMap[word] = false;
                animateCardFlip(cardEl, false);
                if (!(this as any).expandedMap[word]) {
                    (this as any).expandedMap[word] = true;
                    if (!(this as any).cachedHeights[word]) {
                        (this as any).cachedHeights[word] = (this as any).collapsedHeight * 3;
                    }
                    if (!(this as any).definitions[word]) {
                        (this as any).loadDefinition(word);
                    }
                    if (!(this as any).examples[word]) {
                        (this as any).loadExample(word);
                    }
                }
                (this as any).$nextTick(() => {
                    (this as any).measureWordHeight(word);
                });
            } else {
                (this as any).toggleExpand(word);
            }
        },
        handleRightClick(word: string) {
            const cardEl = document.querySelector(`[data-word="${CSS.escape(word)}"] .flip-card`) as HTMLElement | null;
            if ((this as any).flippedMap[word]) {
                (this as any).flippedMap[word] = false;
                animateCardFlip(cardEl, false);
            } else {
                // 如果卡片处于展开态，先收起，避免正面展开内容把翻转后的卡片撑大
                if ((this as any).expandedMap[word]) {
                    (this as any).expandedMap[word] = false;
                }
                if (!(this as any).cachedHeights[word]) {
                    (this as any).cachedHeights[word] = (this as any).collapsedHeight * 3;
                }
                if (!(this as any).definitions[word]) {
                    (this as any).loadDefinition(word);
                }
                if (!(this as any).examples[word]) {
                    (this as any).loadExample(word);
                }
                (this as any).flippedMap[word] = true;
                animateCardFlip(cardEl, true);
            }
            (this as any).$nextTick(() => {
                (this as any).measureWordHeight(word);
            });
        },
        toggleExpand(word: string) {
            if ((this as any).expandedMap[word]) {
                (this as any).expandedMap[word] = false;
            } else {
                (this as any).expandedMap[word] = true;
                if (!(this as any).cachedHeights[word]) {
                    (this as any).cachedHeights[word] = (this as any).collapsedHeight * 3;
                }
                if (!(this as any).definitions[word]) {
                    (this as any).loadDefinition(word);
                }
                if (!(this as any).examples[word]) {
                    (this as any).loadExample(word);
                }
                (this as any).$nextTick(() => {
                    (this as any).measureWordHeight(word);
                });
            }
        },
        async loadDefinition(word: string) {
            if ((this as any).definitions[word] && (this as any).definitions[word] !== (this as any).loadingHtml) return;
            if ((this as any).loadingDefinitions[word]) return;

            (this as any).loadingDefinitions[word] = true;
            (this as any).definitions[word] = (this as any).loadingHtml;

            try {
                const response = await fetch(`/api/search?word=${encodeURIComponent(word)}`);
                const data = await response.json();

                let html = '';
                if (data.success && data.data) {
                    html = buildTranslationHtml(data.data.translation, data.data.phonetic, data.data.definition);
                    if (!html) html = '<p style="color: var(--text-gray); margin: 0;">暂无释义</p>';
                } else {
                    const td = await apiTranslate(word);
                    if (td.success && td.translation) {
                        html = `<div style="margin: 5px 0;"><span style="font-weight: bold; color: var(--accent-green);">翻译:</span> <span style="color: var(--text-dark);">${td.translation}</span></div>`;
                    } else {
                        html = '<p style="color: var(--text-gray); margin: 0;">暂无释义</p>';
                    }
                }

                (this as any).definitions[word] = html;
                await (this as any).$nextTick();
                (this as any).measureWordHeight(word);
            } catch (e: unknown) {
                console.error('加载释义出错:', e);
                (this as any).definitions[word] = '<p style="color: var(--accent-red); margin: 0;">加载释义失败</p>';
            } finally {
                (this as any).loadingDefinitions[word] = false;
            }
        },
        async loadExample(word: string) {
            if ((this as any).loadingExamples[word]) return;
            (this as any).loadingExamples[word] = true;

            try {
                const response = await fetch(`/api/examples?word=${encodeURIComponent(word)}`);
                const data = await response.json();

                let html = '';
                if (data.success && data.data && data.data.length > 0) {
                    const randomIndex = Math.floor(Math.random() * data.data.length);
                    const example = data.data[randomIndex];

                    if (example.text && example.translation) {
                        const clickableEn = (this as any).makeClickableWords(example.text);
                        html = `<div class="example-english">${clickableEn}</div>`;
                        html += `<div class="example-chinese">${example.translation}</div>`;
                    }
                }

                (this as any).examples[word] = html || '';
                await (this as any).$nextTick();
                (this as any).measureWordHeight(word);
            } catch (e: unknown) {
                console.error('加载例句出错:', e);
                (this as any).examples[word] = '';
            } finally {
                (this as any).loadingExamples[word] = false;
            }
        },
        makeClickableWords(text: string) {
            if (!text) return text;
            return text.replace(/([a-zA-Z][a-zA-Z0-9'-]*)/g, (match) => {
                return `<span class="clickable-word" onclick="event.stopPropagation(); g('jumpToWord','${match.replace(/'/g, "\\'")}')">${match}</span>`;
            });
        },
        measureWordHeight(word: string) {
            const el = document.querySelector(`[data-word="${CSS.escape(word)}"]`) as HTMLElement | null;
            if (!el) {
                setTimeout(() => {
                    const el2 = document.querySelector(`[data-word="${CSS.escape(word)}"]`) as HTMLElement | null;
                    if (el2) {
                        (this as any).cachedHeights[word] = el2.offsetHeight + 50;
                    }
                }, 100);
                return;
            }

            const flipCard = el.querySelector('.flip-card') as HTMLElement | null;
            const back = el.querySelector('.flip-card-back') as HTMLElement | null;

            if ((this as any).flippedMap[word] && back && flipCard) {
                const originalBackHeight = back.style.height;
                back.style.height = 'auto';
                const backHeight = back.scrollHeight;
                back.style.height = originalBackHeight;
                flipCard.style.minHeight = backHeight + 'px';
                back.style.alignItems = backHeight > (this as any).collapsedHeight * 1.5 ? 'flex-start' : 'center';
            } else if (flipCard) {
                flipCard.style.minHeight = '';
                if (back) back.style.alignItems = '';
            }

            (this as any).cachedHeights[word] = el.offsetHeight + 50;
            setTimeout(() => {
                const el2 = document.querySelector(`[data-word="${CSS.escape(word)}"]`) as HTMLElement | null;
                if (el2) {
                    (this as any).cachedHeights[word] = el2.offsetHeight + 50;
                }
            }, 100);
        },
        measureVisibleHeights() {
            const items = ((this as any).visibleItems || []) as Array<{ word: string }>;
            items.forEach((item: { word: string }) => {
                (this as any).measureWordHeight(item.word);
            });
        },
        _animateWordRemoval(word: string, doRemove: () => void) {
            const cardEl = document.querySelector(`[data-word="${CSS.escape(word)}"]`) as HTMLElement | null;
            if (cardEl) {
                animateCardExit(cardEl, doRemove);
            } else {
                doRemove();
            }
        },
    },
};