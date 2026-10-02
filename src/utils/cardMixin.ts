// 卡片翻转/展开/释义/例句等共享逻辑，供 wordbook/favorites/errorbook Vue 组件复用
import { animateCardFlip, animateCardExit } from './gsap';
import { apiTranslate } from './api';
import { buildTranslationHtml } from './translation';
import { CARD_GAP } from '../constants';

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
            // 翻转背面按需挂载：未翻转的卡片不渲染背面，避免背面内容在某些渲染环境下穿透
            backMountMap: {} as Record<string, boolean>,
            collapsedHeight: 140,
            loadingHtml: '<p style="color: var(--primary-blue); margin: 0;">正在加载释义...</p>',
        };
    },
    methods: {
        // 限定在当前 Vue 组件内查询，避免多页面同时挂载时命中隐藏页面元素
        _wordEl(word: string): HTMLElement | null {
            const root = (this as any).$el as HTMLElement | null;
            if (!root) return null;
            return root.querySelector(`[data-word="${CSS.escape(word)}"]`) as HTMLElement | null;
        },
        handleLeftClick(word: string) {
            const el = (this as any)._wordEl(word);
            const cardEl = el?.querySelector('.flip-card') as HTMLElement | null;
            if ((this as any).flippedMap[word]) {
                (this as any).flippedMap[word] = false;
                animateCardFlip(cardEl, false);
                (this as any)._scheduleAfterFlip(word);
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
            const el = (this as any)._wordEl(word);
            const cardEl = el?.querySelector('.flip-card') as HTMLElement | null;
            if ((this as any).flippedMap[word]) {
                (this as any).flippedMap[word] = false;
                animateCardFlip(cardEl, false);
                // 翻回正面的动画（0.35s）结束后再卸载背面、重测槽位高度
                (this as any)._scheduleAfterFlip(word);
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
                (this as any).backMountMap[word] = true;
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
                // 收起后按收起态重测虚拟列表槽位高度
                (this as any).$nextTick(() => { (this as any).measureWordHeight(word); });
                setTimeout(() => {
                    if (!(this as any).expandedMap[word] && !(this as any).flippedMap[word]) {
                        (this as any).measureWordHeight(word);
                    }
                }, 320);
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
                    html = buildTranslationHtml(data.data.translation, data.data.phonetic, data.data.definition, { pos: data.data.pos, word: data.data.word });
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
            const el = (this as any)._wordEl(word);
            if (!el) {
                setTimeout(() => {
                    if ((this as any)._wordEl(word)) (this as any).measureWordHeight(word);
                }, 100);
                return;
            }

            const flipCard = el.querySelector('.flip-card') as HTMLElement | null;
            const back = el.querySelector('.flip-card-back') as HTMLElement | null;
            const isOpen = !!(this as any).expandedMap[word] || !!(this as any).flippedMap[word];

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

            if (isOpen) {
                // 内容（释义/例句）尚在异步加载时预留 50px 防止下方卡片上顶；
                // 加载完成后按真实高度收槽，避免卡片下方长期留 50px 空白
                const openReserve = () => {
                    const defPending = !!(this as any).loadingDefinitions?.[word] || !(this as any).definitions?.[word];
                    const needExample = !!(this as any).expandedMap[word];
                    const exPending = needExample &&
                        (!!(this as any).loadingExamples?.[word] || !(this as any).examples?.[word]);
                    return (defPending || exPending) ? 50 : CARD_GAP;
                };
                (this as any).cachedHeights[word] = el.offsetHeight + openReserve();
                setTimeout(() => {
                    const el2 = (this as any)._wordEl(word);
                    if (el2 && ((this as any).expandedMap[word] || (this as any).flippedMap[word])) {
                        (this as any).cachedHeights[word] = el2.offsetHeight + openReserve();
                    }
                }, 100);
            } else {
                // 收起态：按卡片真实高度 + 统一间距记录槽位，替代固定 140 导致的宽窄屏间距失调/重叠
                (this as any).setCollapsedHeight(word, el.offsetHeight + CARD_GAP);
                setTimeout(() => {
                    const el2 = (this as any)._wordEl(word);
                    if (el2 && !(this as any).expandedMap[word] && !(this as any).flippedMap[word]) {
                        (this as any).setCollapsedHeight(word, el2.offsetHeight + CARD_GAP);
                    }
                }, 100);
            }
        },
        // 翻回正面动画结束后卸载背面，并按当前状态重测高度
        _scheduleAfterFlip(word: string) {
            setTimeout(() => {
                if (!(this as any).flippedMap[word]) {
                    (this as any).backMountMap[word] = false;
                }
                (this as any).measureWordHeight(word);
            }, 400);
        },
        measureVisibleHeights() {
            const items = ((this as any).visibleItems || []) as Array<{ word: string }>;
            let dirty = false;
            for (const item of items) {
                const word = item.word;
                const isOpen = !!((this as any).expandedMap[word] || (this as any).flippedMap[word]);
                // 展开/翻转卡内容异步变化，每次可见都重测；收起卡只测未测量过的
                if (isOpen || !(this as any).collapsedHeights[word]) {
                    dirty = true;
                    break;
                }
            }
            if (!dirty) return;
            items.forEach((item: { word: string }) => {
                (this as any).measureWordHeight(item.word);
            });
        },
        _animateWordRemoval(word: string, doRemove: () => void) {
            const cardEl = (this as any)._wordEl(word);
            if (cardEl) {
                animateCardExit(cardEl, doRemove);
            } else {
                doRemove();
            }
        },
    },
};