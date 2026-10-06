// 听力卡壳词：统一的写入 / 查询 / 弹幕提示 / 查词补全
// 数据结构见 types/word.d.ts 的 ListeningStuckWord；持久化由 store 嵌套 Proxy 自动完成。
import { appState } from '../store';
import { showToast } from './gsap';
import { parseMeanings, fallbackPart } from './translation';

export interface StuckInput {
    word: string;
    phonetic?: string;
    meanings?: WordMeaning[];
}

// 统一用小写原形作 key，避免句首大写（The / Apple）与单词测验记录产生重复条目
function keyOf(word: string): string {
    return (word || '').trim().toLowerCase();
}

// 是否已在听力卡壳词中
export function isListeningStuck(word: string): boolean {
    const k = keyOf(word);
    return !!k && !!appState.listeningStuckWords[k];
}

// 核心写入：返回 true=本次新建，false=此前已存在（stuckCount 已 +1）
export function addListeningStuckWord(input: StuckInput): boolean {
    const key = keyOf(input.word);
    if (!key) return false;
    const existing = appState.listeningStuckWords[key];
    appState.listeningStuckWords[key] = {
        word: key,
        phonetic: input.phonetic || existing?.phonetic,
        meanings: (input.meanings && input.meanings.length > 0) ? input.meanings : existing?.meanings,
        stuckCount: (existing?.stuckCount || 0) + 1,
        lastStuckTime: Date.now(),
    };
    return !existing;
}

// 带弹幕提示：新词提示“已添加”，已存在提示“卡壳次数 +1”
export function addListeningStuckWithToast(input: StuckInput): boolean {
    const existed = isListeningStuck(input.word);
    const created = addListeningStuckWord(input);
    if (!created) return false;
    const label = keyOf(input.word);
    if (existed) {
        showToast(`「${label}」已在听力卡壳词中，卡壳次数 +1`, 'info');
    } else {
        showToast(`已将「${label}」添加为听力卡壳词`, 'success');
    }
    return true;
}

// 查词补全：在听力原文上右键时只有单词，异步拉取音标 / 释义回填；
// 不阻塞弹幕、失败静默（卡壳词本身已记录）。仅补空缺字段，不覆盖已有内容。
export async function enrichStuckWord(word: string): Promise<void> {
    const key = keyOf(word);
    if (!key) return;
    try {
        const r = await fetch('/api/search?word=' + encodeURIComponent(key));
        const d = await r.json();
        if (!d || !d.success || !d.data) return;
        const a = d.data;
        const parsed = parseMeanings(a.translation, a.definition, { pos: a.pos, word: key });
        const meanings: WordMeaning[] = parsed.length
            ? parsed
            : [{ part: fallbackPart(a.pos, key), definition: a.translation || '' }];
        const existing = appState.listeningStuckWords[key];
        appState.listeningStuckWords[key] = {
            word: key,
            phonetic: existing?.phonetic || a.phonetic || '',
            meanings: (existing?.meanings && existing.meanings.length) ? existing.meanings : meanings,
            stuckCount: existing?.stuckCount || 1,
            lastStuckTime: existing?.lastStuckTime || Date.now(),
        };
    } catch {
        /* 静默：补全失败不影响已记录的卡壳词 */
    }
}
