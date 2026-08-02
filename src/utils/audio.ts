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
// 缓存 blob URL，避免重复网络请求；存储的是 objectURL 字符串而非 Audio 实例
const audioCache = new Map<string, string>();

/**
 * 执行队列中的下一个任务
 */
function processQueue(): void {
    if (queue.length === 0 || activeCount >= MAX_CONCURRENT) return;

    const task = queue.shift()!;
    activeCount++;

    loadWithFetch(task)
        .then((url) => {
            activeCount--;
            audioCache.set(task.src, url);
            const audio = new Audio(url);
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

async function loadWithFetch(task: AudioTask): Promise<string> {
    try {
        const response = await fetch(task.src);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        return url;
    } catch (err) {
        throw err;
    }
}

/**
 * 加载音频（受队列控制）
 */
function loadAudio(src: string): Promise<HTMLAudioElement> {
    // 缓存命中：直接从 blob URL 创建新 Audio 实例，不发网络请求
    const cachedUrl = audioCache.get(src);
    if (cachedUrl) {
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
 * 停止所有正在播放的音频
 */
export function stopAllAudio(): void {
    // 遍历缓存中的 blob URL 停止
    audioCache.forEach(url => {
        const audio = new Audio(url);
        audio.pause();
    });
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
