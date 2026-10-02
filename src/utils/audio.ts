import { AUDIO_MAX_CONCURRENT, AUDIO_MAX_RETRIES, AUDIO_PRELOAD_COUNT } from '../constants';

// 请求队列
interface AudioTask {
    src: string;
    resolve: (audio: HTMLAudioElement) => void;
    reject: (reason: Error) => void;
    retries: number;
}

let activeCount = 0;
const queue: AudioTask[] = [];
// 缓存 blob URL，避免重复网络请求；存储的是 objectURL 字符串而非 Audio 实例
// 上限 32 个的 LRU：超限时淘汰最久未使用的 blob URL 并 URL.revokeObjectURL 释放内存
const AUDIO_CACHE_MAX = 32;
const audioCache = new Map<string, string>();
// 受保护的 blob URL 集合：当前正在播放 / 刚交给 play 的发音，淘汰时绝不能 revoke，
// 否则正在响的音频会突然中断。播放结束或被新发音顶替后移出保护集。
const protectedBlobUrls = new Set<string>();

// 命中缓存时刷新 LRU 顺序（移到队尾，标记为最近使用）
function touchAudioCache(src: string): void {
    const url = audioCache.get(src);
    if (url !== undefined) {
        audioCache.delete(src);
        audioCache.set(src, url);
    }
}

// LRU 淘汰：超出上限时从队首（最久未使用）淘汰，revoke 未受保护的 blob URL；
// 受保护项（正在播放）跳过，此时缓存可临时略超上限，待播放结束后再被正常淘汰
function evictAudioCacheIfNeeded(): void {
    let over = audioCache.size - AUDIO_CACHE_MAX;
    if (over <= 0) return;
    for (const [src, url] of audioCache) {
        if (over <= 0) break;
        if (protectedBlobUrls.has(url)) continue;
        audioCache.delete(src);
        try { URL.revokeObjectURL(url); } catch { /* 已失效的 URL 忽略 */ }
        over--;
    }
}

// 写入缓存：同 key 覆盖时先回收旧 blob；写入后触发 LRU 淘汰
function setAudioCache(src: string, blobUrl: string): void {
    const old = audioCache.get(src);
    if (old !== undefined && old !== blobUrl) {
        audioCache.delete(src);
        if (!protectedBlobUrls.has(old)) {
            try { URL.revokeObjectURL(old); } catch { /* ignore */ }
        }
    }
    audioCache.set(src, blobUrl);
    evictAudioCacheIfNeeded();
}

// 当前正在播放的单词/句子发音；新发音开始前先停掉旧的，避免快速连续点击/自动连播时声音重叠
let currentWordAudio: HTMLAudioElement | null = null;

function playAudioExclusive(audio: HTMLAudioElement): Promise<void> {
    if (currentWordAudio && currentWordAudio !== audio) {
        try {
            currentWordAudio.pause();
            currentWordAudio.currentTime = 0;
        } catch { /* 旧 Audio 可能已销毁，忽略 */ }
        // 旧发音被新发音顶替：其 blob 不再受保护，可被 LRU 正常淘汰
        if (currentWordAudio.src) protectedBlobUrls.delete(currentWordAudio.src);
    }
    currentWordAudio = audio;
    // 本次即将播放的 blob 进入保护集，淘汰时绝不 revoke
    if (audio.src) protectedBlobUrls.add(audio.src);
    audio.onended = () => {
        if (currentWordAudio === audio) {
            currentWordAudio = null;
            if (audio.src) protectedBlobUrls.delete(audio.src);
        }
    };
    return audio.play();
}

/**
 * 执行队列中的下一个任务
 */
function processQueue(): void {
    if (queue.length === 0 || activeCount >= AUDIO_MAX_CONCURRENT) return;

    const task = queue.shift()!;
    activeCount++;

    loadWithFetch(task)
        .then((url) => {
            activeCount--;
            setAudioCache(task.src, url);
            const audio = new Audio(url);
            task.resolve(audio);
            processQueue();
        })
        .catch(() => {
            activeCount--;
            if (task.retries < AUDIO_MAX_RETRIES) {
                task.retries++;
                queue.unshift(task);
                console.warn(`Audio load failed, retry ${task.retries}/${AUDIO_MAX_RETRIES}: ${task.src}`);
                setTimeout(processQueue, 200);
            } else {
                console.error(`Audio load failed after ${AUDIO_MAX_RETRIES} retries: ${task.src}`);
                task.reject(new Error(`Failed to load audio: ${task.src}`));
                processQueue();
            }
        });
}

async function loadWithFetch(task: AudioTask): Promise<string> {
    const response = await fetch(task.src);
    if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
    }
    const blob = await response.blob();
    return URL.createObjectURL(blob);
}

/**
 * 加载音频（受队列控制）
 */
function loadAudio(src: string): Promise<HTMLAudioElement> {
    // 缓存命中：直接从 blob URL 创建新 Audio 实例，不发网络请求
    const cachedUrl = audioCache.get(src);
    if (cachedUrl) {
        touchAudioCache(src); // 刷新 LRU 顺序，避免刚被取走就被淘汰
        const audio = new Audio(cachedUrl);
        audio.playbackRate = getPlaybackRate();
        return Promise.resolve(audio);
    }

    return new Promise((resolve, reject) => {
        queue.push({
            src,
            resolve: (url: any) => {
                const audio = new Audio(url);
                audio.playbackRate = getPlaybackRate();
                resolve(audio);
            },
            reject,
            retries: 0
        });
        processQueue();
    });
}

/**
 * 预加载音频（不阻塞，静默失败）
 * @param items 预加载列表
 * @param startIndex 从哪个索引开始预加载（当前播放位置之后）
 */
export function preloadAudio(items: Array<{ word: string; accent?: string }>, startIndex: number = 0, count: number = AUDIO_PRELOAD_COUNT): void {
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
let appState: { settings: { pronunciationType: string; soundEnabled: boolean; playbackRate: number } };

export function setAppState(state: { settings: { pronunciationType: string; soundEnabled: boolean; playbackRate: number } }): void {
    appState = state;
}

function getPlaybackRate(): number {
    if (!appState) return 1.0;
    const rate = appState.settings.playbackRate;
    return (typeof rate === 'number' && rate >= 0.5 && rate <= 2.0) ? rate : 1.0;
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
        await playAudioExclusive(audio);
        console.log('Pronunciation played:', word);

        // 播放成功后就近预加载
        if (preloadItems && currentIndex !== undefined) {
            preloadAudio(preloadItems, currentIndex + 1, AUDIO_PRELOAD_COUNT);
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
            await playAudioExclusive(audio);
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
        await playAudioExclusive(audio);
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

// ==================== Web Audio API 合成提示音 ====================

let audioContext: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    if (!audioContext) {
        try {
            audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
        } catch {
            return null;
        }
    }
    // 若之前被 suspend，尝试恢复
    if (audioContext && audioContext.state === 'suspended') {
        void audioContext.resume();
    }
    return audioContext;
}

function isSoundEnabled(): boolean {
    // 默认开启；如果用户未保存过设置，返回 true
    if (!appState) return true;
    return appState.settings.soundEnabled !== false;
}

/**
 * 播放一个简单的蜂鸣音（内部基础函数）
 */
function playTone(frequency: number, duration: number, type: OscillatorType = 'sine', volume = 0.15): void {
    const ctx = getAudioContext();
    if (!ctx || !isSoundEnabled()) return;

    const oscillator = ctx.createOscillator();
    const gainNode = ctx.createGain();

    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, ctx.currentTime);

    gainNode.gain.setValueAtTime(0, ctx.currentTime);
    gainNode.gain.linearRampToValueAtTime(volume, ctx.currentTime + 0.01);
    gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);

    oscillator.connect(gainNode);
    gainNode.connect(ctx.destination);

    oscillator.start(ctx.currentTime);
    oscillator.stop(ctx.currentTime + duration);
}

/**
 * 播放答对提示音：清脆上扬双音
 */
export function playCorrectSound(): void {
    const ctx = getAudioContext();
    if (!ctx || !isSoundEnabled()) return;

    const now = ctx.currentTime;
    [523.25, 659.25, 783.99].forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now + idx * 0.06);
        gain.gain.setValueAtTime(0, now + idx * 0.06);
        gain.gain.linearRampToValueAtTime(0.12, now + idx * 0.06 + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.06 + 0.18);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now + idx * 0.06);
        osc.stop(now + idx * 0.06 + 0.18);
    });
}

/**
 * 播放答错提示音：低沉下降音
 */
export function playWrongSound(): void {
    const ctx = getAudioContext();
    if (!ctx || !isSoundEnabled()) return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(220, now);
    osc.frequency.exponentialRampToValueAtTime(110, now + 0.25);
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.12, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.28);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.28);
}

/**
 * 播放按钮点击音：极短高频轻击
 */
export function playClickSound(): void {
    playTone(880, 0.05, 'triangle', 0.08);
}

/**
 * 播放完成/通关提示音：轻快乐句
 */
export function playCompleteSound(): void {
    const ctx = getAudioContext();
    if (!ctx || !isSoundEnabled()) return;

    const now = ctx.currentTime;
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now + idx * 0.1);
        gain.gain.setValueAtTime(0, now + idx * 0.1);
        gain.gain.linearRampToValueAtTime(0.12, now + idx * 0.1 + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.1 + 0.25);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now + idx * 0.1);
        osc.stop(now + idx * 0.1 + 0.25);
    });
}

/**
 * 设置音效开关
 */
export function setSoundEnabled(enabled: boolean): void {
    if (appState) {
        appState.settings.soundEnabled = enabled;
    }
}
