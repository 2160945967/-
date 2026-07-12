import { AUDIO_MAX_CONCURRENT, AUDIO_MAX_RETRIES, AUDIO_PRELOAD_COUNT } from '../constants';
const MAX_CONCURRENT = AUDIO_MAX_CONCURRENT;
const MAX_RETRIES = AUDIO_MAX_RETRIES;
const PRELOAD_COUNT = AUDIO_PRELOAD_COUNT;

// 请求队列
interface AudioTask {
    src: string;
    resolve: (audio: HTMLAudioElement) => void;
    reject: (reason: Error) => void;
    retries: number;
}

let activeCount = 0;
const queue: AudioTask[] = [];
const audioCache = new Map<string, HTMLAudioElement>();

/**
 * 执行队列中的下一个任务
 */
function processQueue(): void {
    if (queue.length === 0 || activeCount >= MAX_CONCURRENT) return;

    const task = queue.shift()!;
    activeCount++;

    loadWithFetch(task)
        .then((audio) => {
            activeCount--;
            audioCache.set(task.src, audio);
            task.resolve(audio);
            processQueue();
        })
        .catch(() => {
            activeCount--;
            if (task.retries < MAX_RETRIES) {
                task.retries++;
                queue.unshift(task);
                console.warn(`Audio load failed, retry ${task.retries}/${MAX_RETRIES}: ${task.src}`);
                setTimeout(processQueue, 200);
            } else {
                console.error(`Audio load failed after ${MAX_RETRIES} retries: ${task.src}`);
                task.reject(new Error(`Failed to load audio: ${task.src}`));
                processQueue();
            }
        });
}

async function loadWithFetch(task: AudioTask): Promise<HTMLAudioElement> {
    try {
        const response = await fetch(task.src);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);

        return new Promise((resolve, reject) => {
            const audio = new Audio();
            audio.oncanplay = () => resolve(audio);
            audio.onerror = () => {
                URL.revokeObjectURL(url);
                reject(new Error('Audio play failed'));
            };
            audio.src = url;
            audio.load();
        });
    } catch (err) {
        throw err;
    }
}

/**
 * 加载音频（受队列控制）
 */
function loadAudio(src: string): Promise<HTMLAudioElement> {
    // 缓存命中直接返回
    const cached = audioCache.get(src);
    if (cached) {
        // 克隆新实例以便独立播放
        const clone = new Audio(src);
        return Promise.resolve(clone);
    }

    return new Promise((resolve, reject) => {
        queue.push({ src, resolve, reject, retries: 0 });
        processQueue();
    });
}

/**
 * 预加载音频（不阻塞，静默失败）
 * @param items 预加载列表
 * @param startIndex 从哪个索引开始预加载（当前播放位置之后）
 */
export function preloadAudio(items: Array<{ word: string; accent?: string }>, startIndex: number = 0, count: number = PRELOAD_COUNT): void {
    if (!appState) return;
    const accent = appState.settings.pronunciationType || 'us';
    for (let i = startIndex; i < Math.min(startIndex + count, items.length); i++) {
        const item = items[i];
        const word = item.word;
        const acc = item.accent || accent;
        const src = `/api/audio/${acc}/${encodeURIComponent(word)}.mp3`;
        if (!audioCache.has(src)) {
            loadAudio(src).catch(() => {}); // 静默失败
        }
    }
}

// 需要从 global 导入 appState，使用延迟导入避免循环依赖
let appState: { settings: { pronunciationType: string } };

export function setAppState(state: { settings: { pronunciationType: string } }): void {
    appState = state;
}

/**
 * 播放单词发音（队列管理 + 就近预加载）
 * @param type 口音类型（us/uk）
 * @param word 单词
 * @param preloadItems 用于预加载的单词列表（可选）
 * @param currentIndex 当前播放单词在列表中的索引（可选）
 */
export async function playPronunciation(
    type: string,
    word?: string,
    preloadItems?: Array<{ word: string }>,
    currentIndex?: number
): Promise<void> {
    if (!word) {
        word = document.getElementById('word')?.textContent || '';
    }
    if (!word) return;

    const src = `/api/audio/${type}/${encodeURIComponent(word)}.mp3`;

    try {
        const audio = await loadAudio(src);
        await audio.play();
        console.log('Pronunciation played:', word);

        // 播放成功后就近预加载
        if (preloadItems && currentIndex !== undefined) {
            preloadAudio(preloadItems, currentIndex + 1, PRELOAD_COUNT);
        }
    } catch (error: unknown) {
        console.error('Audio play failed:', error);
        // 回退到直接生成发音
        await tryGenerateAndPlay(type, word);
    }
}

/**
 * 生成发音并播放（回退方案）
 */
async function tryGenerateAndPlay(type: string, word: string): Promise<void> {
    try {
        const response = await fetch('/api/audio/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: word, accent: type })
        });

        const data = await response.json();

        if (data.success) {
            const cacheSrc = `/api/audio/cache/${type}/${encodeURIComponent(word)}.mp3`;
            const audio = await loadAudio(cacheSrc);
            await audio.play();
            console.log('Generated pronunciation played:', word);
        }
    } catch (err: unknown) {
        console.error('Failed to generate pronunciation:', err);
    }
}

/**
 * 播放句子发音
 */
export async function playSentencePronunciation(type: string, sentence: string): Promise<void> {
    if (!sentence) return;

    const src = `/api/audio/${type}/${encodeURIComponent(sentence)}.mp3`;

    try {
        const audio = await loadAudio(src);
        await audio.play();
    } catch {
        await tryGenerateAndPlay(type, sentence);
    }
}

/**
 * 获取队列状态（用于调试/监控）
 */
export function getAudioQueueStatus(): { active: number; queued: number; cached: number } {
    return {
        active: activeCount,
        queued: queue.length,
        cached: audioCache.size
    };
}
