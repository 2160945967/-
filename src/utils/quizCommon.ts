// 测验/复习公共逻辑：IME 输入法处理、快捷键、防抖、释义选择

import { appState } from '../global';
import { playPronunciation } from './audio';
import { QuizMode } from '../types/enums';

// 为输入框绑定中文输入法处理
export function setupImeHandling(input: HTMLInputElement): {
    isComposing: () => boolean;
    justComposed: () => boolean;
} {
    let isComposing = false;
    let justComposed = false;

    input.addEventListener('compositionstart', () => {
        isComposing = true;
        justComposed = false;
    });

    input.addEventListener('compositionend', () => {
        isComposing = false;
        justComposed = true;
        setTimeout(() => { justComposed = false; }, 100);
    });

    // 输入法激活时禁止数字键（防止选词被拦截）
    input.addEventListener('keydown', (e: KeyboardEvent) => {
        if (/^[0-9]$/.test(e.key) && !isComposing) {
            e.preventDefault();
        }
    });

    return { isComposing: () => isComposing, justComposed: () => justComposed };
}

// 为输入框绑定 Enter 提交
export function setupEnterSubmission(
    input: HTMLInputElement,
    imeState: { isComposing: () => boolean; justComposed: () => boolean },
    onEnter: () => void
): void {
    input.addEventListener('keyup', (e: KeyboardEvent) => {
        if (e.key !== 'Enter') return;
        if (imeState.isComposing() || imeState.justComposed()) return;
        if (input.disabled) return;
        e.stopPropagation();
        e.preventDefault();
        onEnter();
    });
}

// 全局快捷键（answerKey 显示答案 / playKey 播放发音）
export function setupGlobalShortcuts(
    containerSelector: string,
    answerInputId: string,
    onAnswer: () => void,
    onPlay: (word: string) => void,
    getCurrentWord: () => string | undefined
): { remove: () => void } {
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;

    const handler = (e: KeyboardEvent) => {
        const containerEl = document.querySelector(containerSelector);
        if (!containerEl || !containerEl.classList.contains('quiz-container-visible')) return;

        const answerKey = appState.settings.answerKey;
        const playKey = appState.settings.playPronunciationKey;

        if (e.key !== answerKey && e.key !== playKey) return;

        const answerEl = document.getElementById(answerInputId) as HTMLInputElement;
        // 在输入框中：仅数字键触发快捷键
        if (document.activeElement === answerEl && !/^[0-9]$/.test(e.key)) {
            return;
        }

        if (e.key === answerKey) {
            if (debounceTimer) return;
            onAnswer();
            debounceTimer = setTimeout(() => { debounceTimer = null; }, 100);
            return;
        }

        if (e.key === playKey) {
            const word = getCurrentWord();
            if (word) onPlay(word);
        }
    };

    document.addEventListener('keyup', handler);
    return { remove: () => document.removeEventListener('keyup', handler) };
}

// 防抖包装
export function createDebouncedHandler(fn: () => void, delay: number = 500): () => void {
    let timer: ReturnType<typeof setTimeout> | null = null;
    return () => {
        if (timer) return;
        timer = setTimeout(() => { timer = null; }, delay);
        fn();
    };
}

// 输入冷却期管理（EnToZh 模式下，输入后 300ms 内禁用快捷键）
export function setupInputCooldown(input: HTMLInputElement): void {
    input.addEventListener('input', () => {
        const quizModeSelect = document.getElementById('quiz-mode') as HTMLSelectElement;
        if (!quizModeSelect || quizModeSelect.value !== QuizMode.EnToZh) return;

        appState.isInInputCooldown = true;
        if (appState.inputCooldownTimer) {
            clearTimeout(appState.inputCooldownTimer);
        }
        appState.inputCooldownTimer = setTimeout(() => {
            appState.isInInputCooldown = false;
            appState.inputCooldownTimer = null;
        }, 300);
    });
}

// /api/words/batch 服务端单批上限
export const BATCH_WORD_LIMIT = 500;

// 分片调用 /api/words/batch：每片 <=500 个，串行发完所有片，合并所有成功片的结果。
// 不引入新的全局状态；单批失败时跳过该批（partial success），网络异常向上抛出由调用方 catch。
export async function fetchWordDefinitionsInBatches(
    words: string[]
): Promise<Array<{ word: string; info?: { meanings?: Array<{ part: string; definition: string }>; translation?: string; phonetic?: string } }>> {
    const merged: Array<{ word: string; info?: { meanings?: Array<{ part: string; definition: string }>; translation?: string; phonetic?: string } }> = [];
    for (let i = 0; i < words.length; i += BATCH_WORD_LIMIT) {
        const chunk = words.slice(i, i + BATCH_WORD_LIMIT);
        const response = await fetch('/api/words/batch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ words: chunk })
        });
        const result = await response.json();
        if (result && result.success && result.data) {
            merged.push(...result.data);
        }
    }
    return merged;
}

// 从释义中随机选择（按分号分组，每组随机选一个，打乱顺序）
interface WordMeaning {
    part: string;
    definition: string;
}

export function getRandomMeanings(meanings: WordMeaning[]): string[] {
    let allSelected: string[] = [];
    meanings.forEach(meaning => {
        const mainGroups = meaning.definition.split(/[；;]/).filter(part => part.trim() !== '');
        mainGroups.forEach(group => {
            const subParts = group.split(/[，,]/).filter(part => part.trim() !== '');
            if (subParts.length > 0) {
                const randomIndex = Math.floor(Math.random() * subParts.length);
                allSelected.push(subParts[randomIndex].trim());
            }
        });
    });
    // Fisher-Yates 洗牌
    for (let i = allSelected.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [allSelected[i], allSelected[j]] = [allSelected[j], allSelected[i]];
    }
    return allSelected;
}