// 词典页面：搜索、查词、翻译、发音、语音输入、搜索建议、查词历史

import { appState, switchPage, navigateToWord, jumpToWord, isWordJumping, isCrossPageJumping, onWordJumpDone, getWordJumpElapsed, pageHandlers, escapeHtml, escapeForJsString } from '../global';
import { updateStudyStats } from './stats';
import { loadSettings } from './settings';
import { updateAllWordbookSelectors, normalizeCaseByType } from './wordbook';

import { updateFavoritesDisplay } from './favorites';
import { getRegistry } from '../global-registry';
import { apiGet, apiPost, apiTranslate } from '../utils/api';
import { parseMeanings, normalizeNewlines, formatDefinitionHtml } from '../utils/translation';
import { showToast, animateResultShow } from '../utils/gsap';

let _dictDocClickHandler: ((e: Event) => void) | null = null;

/**
 * 规范化标签显示：
 * - cet46 拆分为 cet4、cet6
 * - 同时存在 coca 和 coca20000 时只保留 coca
 * - 不显示 sum_all 汇总标记
 * - 仅显示白名单内的标签（小学/中考/高考/四六级/专四专八/考研/托福/雅思/GRE/COCA）
 */
function normalizeDisplayTags(rawTags: string): string[] {
    const rawList = rawTags.split(/\s+/).map(t => t.trim()).filter(Boolean);
    // 允许显示的标签白名单
    const allowedTags = new Set([
        'xx', 'zk', 'gk',
        'cet4', 'cet6',
        'tem4', 'tem8',
        'ky',
        'toefl', 'ielts',
        'gre',
        'coca', 'coca20000',
    ]);
    const result: string[] = [];
    const hasCoca = rawList.includes('coca');
    const seen = new Set<string>();
    rawList.forEach(tag => {
        if (tag === 'sum_all') return;
        if (tag === 'cet46') {
            ['cet4', 'cet6'].forEach(t => {
                if (!seen.has(t)) {
                    seen.add(t);
                    result.push(t);
                }
            });
            return;
        }
        if (tag === 'coca20000' && hasCoca) return;
        // 不在白名单中的标签不显示
        if (!allowedTags.has(tag)) return;
        if (!seen.has(tag)) {
            seen.add(tag);
            result.push(tag);
        }
    });
    return result;
}

/** 资源下载状态缓存 */
let assetStatusCache: Record<string, boolean> = {};

async function refreshAssetStatusCache(): Promise<void> {
    try {
        const response = await fetch('/api/assets/status');
        const result = await response.json();
        if (result.success && result.data) {
            const cache: Record<string, boolean> = {};
            (result.data as Array<{ id: string; downloaded: boolean }>).forEach((a) => {
                cache[a.id] = a.downloaded;
            });
            assetStatusCache = cache;
        }
    } catch (e) {
        console.error('[dictionary] 获取资源状态失败:', e);
    }
}

function isAssetDownloaded(assetId: string): boolean {
    return !!assetStatusCache[assetId];
}

function createMissingAssetPrompt(assetName: string): string {
    return `<div class="missing-asset-prompt">
        <span style="font-weight: 600;">${assetName} 未下载</span>，暂时无法展示。<a href="#" class="jump-to-download" data-action="jump-to-settings">点击此处跳转下载</a>
    </div>`;
}

let _dictScrollHandler: (() => void) | null = null;
let _dictSuggestionsMousemoveHandler: ((e: MouseEvent) => void) | null = null;
let lastSearchHistorySignature = '';

export function initSearch(): void {
    const searchButton = document.getElementById('search-button');
    const voiceButton = document.getElementById('voice-button');
    const searchInput = document.getElementById('search-input') as HTMLInputElement;
    const suggestionsDropdown = document.getElementById('suggestions-dropdown') as HTMLElement;
    const result = document.getElementById('result');

    if (!searchButton || !voiceButton || !suggestionsDropdown || !searchInput) return;

    // 初始化资源状态缓存，并定时刷新
    void refreshAssetStatusCache();
    setInterval(() => void refreshAssetStatusCache(), 30000);

    // 未下载资源提示的跳转链接
    if (result) {
        result.addEventListener('click', function(e) {
            const target = e.target as HTMLElement;
            if (target && target.classList.contains('jump-to-download')) {
                e.preventDefault();
                void switchPage('settings');
            }
        });
    }

    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    let activeIndex: number = -1;
    let currentSuggestions: Array<{ word: string }> = [];
    let keyboardNav: boolean = false;
    let keyboardNavTimeout: ReturnType<typeof setTimeout> | null = null;

    if (searchButton) {
        searchButton.addEventListener('click', function() {
            const text = searchInput.value.trim();
            if (text) {
                searchWord(text);
                hideSuggestions();
            }
        });
    }

    if (searchInput) {
        searchInput.addEventListener('input', function() {
            const text = this.value.trim();
            if (debounceTimer) clearTimeout(debounceTimer);
            if (text.length < 3) {
                hideSuggestions();
                return;
            }
            debounceTimer = setTimeout(() => fetchSuggestions(text), 300);
        });

        searchInput.addEventListener('keydown', function(this: HTMLInputElement, e: KeyboardEvent) {
            const items = suggestionsDropdown.querySelectorAll('.suggestion-item');
            const isOpen = suggestionsDropdown.classList.contains('suggestions-visible');

            if (e.key === 'ArrowDown') {
                e.preventDefault();
                if (isOpen && items.length > 0) {
                    keyboardNav = true;
                    suggestionsDropdown.classList.add('keyboard-nav');
                    if (keyboardNavTimeout) clearTimeout(keyboardNavTimeout);
                    items.forEach(el => { el.classList.remove('mouse-hover'); el.classList.remove('active'); });
                    activeIndex = activeIndex < 0 ? 0 : (activeIndex + 1) % items.length;
                    highlightItem(items);
                }
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                if (isOpen && items.length > 0) {
                    keyboardNav = true;
                    suggestionsDropdown.classList.add('keyboard-nav');
                    if (keyboardNavTimeout) clearTimeout(keyboardNavTimeout);
                    items.forEach(el => { el.classList.remove('mouse-hover'); el.classList.remove('active'); });
                    activeIndex = activeIndex < 0 ? items.length - 1 : (activeIndex === 0 ? items.length - 1 : activeIndex - 1);
                    highlightItem(items);
                }
            } else if (e.key === 'Enter') {
                if (isOpen && activeIndex >= 0 && currentSuggestions[activeIndex]) {
                    e.preventDefault();
                    const word = currentSuggestions[activeIndex].word;
                    getRegistry().selectSuggestion(word);
                } else {
                    const text = this.value.trim();
                    if (text) {
                        searchWord(text);
                        hideSuggestions();
                    }
                }
            } else if (e.key === 'Escape') {
                hideSuggestions();
            }
        });

        searchInput.addEventListener('blur', () => setTimeout(hideSuggestions, 300));

        searchInput.addEventListener('focus', function() {
            if (this.value.trim().length >= 3) {
                fetchSuggestions(this.value.trim());
            }
        });

        suggestionsDropdown.addEventListener('click', (e) => {
            const item = (e.target as HTMLElement).closest('.suggestion-item') as HTMLElement;
            if (item) {
                const word = item.dataset.word;
                if (word) getRegistry().selectSuggestion(word);
            }
        });
    }

    function highlightItem(items: NodeListOf<Element>) {
        items.forEach((item, index) => {
            if (index === activeIndex) {
                item.classList.add('active');
                item.scrollIntoView({ block: 'nearest' });
            } else {
                item.classList.remove('active');
            }
        });
    }

    async function fetchSuggestions(prefix: string) {
        try {
            const examCategoryEl = document.getElementById('exam-category') as HTMLSelectElement;
            const category = examCategoryEl?.value || '';
            const url = `/api/match?prefix=${encodeURIComponent(prefix)}&limit=15&category=${encodeURIComponent(category)}`;
            const result = await apiGet(url);
            if (result.success && result.data && result.data.length > 0) {
                currentSuggestions = result.data;
                showSuggestions(result.data);
            } else {
                hideSuggestions();
            }
        } catch (error: unknown) {
            console.error('获取搜索建议失败:', error);
            hideSuggestions();
        }
    }

    function showSuggestions(words: Array<{ word: string }>) {
        activeIndex = -1;
        keyboardNav = false;
        suggestionsDropdown.classList.remove('keyboard-nav');
        if (keyboardNavTimeout) { clearTimeout(keyboardNavTimeout); keyboardNavTimeout = null; }
        suggestionsDropdown.innerHTML = words.map((item, index) => `
            <div
                class="suggestion-item"
                data-index="${index}"
                data-word="${escapeHtml(item.word)}"
            >
                <div class="suggestion-text">${escapeHtml(item.word)}</div>
            </div>
        `).join('');

        // 下拉框父级可能有 transform（页面入场动画），会导致 fixed 定位偏移，
        // 显示前挂到 body 下，确保以视口为基准
        if (suggestionsDropdown.parentElement !== document.body) {
            document.body.appendChild(suggestionsDropdown);
        }

        const searchContainer = document.querySelector('.search-container');
        if (searchContainer) {
            const rect = searchContainer.getBoundingClientRect();
            suggestionsDropdown.style.left = rect.left + 'px';
            suggestionsDropdown.style.width = rect.width + 'px';
            suggestionsDropdown.style.top = rect.bottom + 'px';
        }

        suggestionsDropdown.classList.add('suggestions-visible');

        // 给每个项添加鼠标事件
        const items = suggestionsDropdown.querySelectorAll('.suggestion-item');
        items.forEach((item, index) => {
            item.addEventListener('mouseenter', function() {
                if (keyboardNav) return;
                items.forEach(el => el.classList.remove('active'));
                items.forEach(el => el.classList.remove('mouse-hover'));
                activeIndex = index;
                this.classList.add('mouse-hover');
            });
            item.addEventListener('mouseleave', function() {
                if (!keyboardNav) {
                    this.classList.remove('mouse-hover');
                }
            });
        });
    }

    // 鼠标在下拉框内移动时退出键盘导航模式（只绑定一次）
    if (_dictSuggestionsMousemoveHandler) {
        suggestionsDropdown.removeEventListener('mousemove', _dictSuggestionsMousemoveHandler);
    }
    _dictSuggestionsMousemoveHandler = function() {
        if (keyboardNav) {
            keyboardNav = false;
            suggestionsDropdown.classList.remove('keyboard-nav');
            const items = suggestionsDropdown.querySelectorAll('.suggestion-item');
            items.forEach(el => el.classList.remove('active'));
            items.forEach(el => el.classList.remove('mouse-hover'));
            activeIndex = -1;
        }
    };
    suggestionsDropdown.addEventListener('mousemove', _dictSuggestionsMousemoveHandler);

    const reg = getRegistry();
    reg.selectSuggestion = function(word: string) {
        searchInput.value = word;
        searchWord(word);
        hideSuggestions();
    };

    function hideSuggestions() {
        suggestionsDropdown.classList.remove('suggestions-visible');
        suggestionsDropdown.classList.remove('keyboard-nav');
        activeIndex = -1;
        keyboardNav = false;
        currentSuggestions = [];
        if (keyboardNavTimeout) { clearTimeout(keyboardNavTimeout); keyboardNavTimeout = null; }
    }

    if (_dictDocClickHandler) {
        document.removeEventListener('click', _dictDocClickHandler);
    }
    _dictDocClickHandler = function(e: Event) {
        if (!(e.target as HTMLElement).closest('.search-container') && !(e.target as HTMLElement).closest('#suggestions-dropdown')) {
            hideSuggestions();
        }
    };
    document.addEventListener('click', _dictDocClickHandler);

    if (_dictScrollHandler) {
        window.removeEventListener('scroll', _dictScrollHandler);
    }
    _dictScrollHandler = function() {
        hideSuggestions();
    };
    window.addEventListener('scroll', _dictScrollHandler, { passive: true });

    // 考试类别选择：初始化、持久化、变更时重新请求
    const examCategoryEl = document.getElementById('exam-category') as HTMLSelectElement;
    if (examCategoryEl) {
        // 从 localStorage 恢复上次选择（如果没有则保持默认 cet4）
        const savedCategory = localStorage.getItem('exam-category');
        if (savedCategory && savedCategory !== '') {
            examCategoryEl.value = savedCategory;
        }
        // 类别变更时重新请求当前搜索建议
        examCategoryEl.addEventListener('change', function() {
            localStorage.setItem('exam-category', this.value);
            const currentText = searchInput.value.trim();
            if (currentText.length >= 3) {
                fetchSuggestions(currentText);
            }
        });
    }

    if (voiceButton) {
        initVoiceRecognition();
    }

    showSearchHistory();
}

let _voiceInited = false;
export function initVoiceRecognition(): void {
    if (_voiceInited) return;
    _voiceInited = true;

    const voiceButton = document.getElementById('voice-button') as HTMLElement;
    const searchInput = document.getElementById('search-input') as HTMLInputElement;

    // Electron 环境：用 Vosk + Web Audio API
    const isElectron = !!(window as any).electronAPI || (navigator.userAgent.toLowerCase().includes('electron'));

    if (isElectron) {
        initVoskVoice(voiceButton, searchInput);
        return;
    }

    // 浏览器环境：用原生 Web Speech API
    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
        voiceButton.title = '您的浏览器不支持语音识别';
        voiceButton.classList.add('voice-btn-disabled');
        return;
    }

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    let recognition: any = null;
    let isListening = false;
    let isStopping = false;

    voiceButton.addEventListener('click', function() {
        if (!recognition) {
            recognition = new SpeechRecognition();
            recognition.continuous = false;
            recognition.interimResults = false;
            recognition.lang = 'en-US';

            recognition.onstart = function() {
                isListening = true;
                isStopping = false;
                voiceButton.classList.add('voice-btn-recording');
            };

            recognition.onresult = function(event: any) {
                const transcript = event.results[0][0].transcript;
                searchInput.value = transcript;
                searchInput.focus();
            };

            recognition.onerror = function(event: any) {
                console.error('语音识别错误:', event.error);
            };

            recognition.onend = function() {
                isListening = false;
                isStopping = false;
                voiceButton.classList.remove('voice-btn-recording');
            };
        }

        if (isStopping) return;

        if (isListening) {
            isStopping = true;
            recognition.stop();
        } else {
            try { recognition.start(); } catch (e) { isStopping = false; }
        }
    });
}

// Vosk 离线语音识别（Electron 环境）
// 用 AudioWorkletNode 在独立音频线程录音，停止后 POST 到后端识别
function initVoskVoice(voiceButton: HTMLElement, searchInput: HTMLInputElement): void {
    let audioContext: AudioContext | null = null;
    let mediaStream: MediaStream | null = null;
    let workletNode: AudioWorkletNode | null = null;
    let isListening = false;
    let isStopping = false;
    let isStarting = false;
    let pendingSamples: Float32Array | null = null;

    function cleanupAll() {
        if (workletNode) { try { workletNode.disconnect(); } catch {} workletNode = null; }
        if (audioContext) { try { audioContext.close(); } catch {} audioContext = null; }
        if (mediaStream) { mediaStream.getTracks().forEach(t => t.stop()); mediaStream = null; }
        pendingSamples = null;
    }

    function floatToBase64Pcm(float32: Float32Array): string {
        const int16 = new Int16Array(float32.length);
        for (let i = 0; i < float32.length; i++) {
            let s = Math.max(-1, Math.min(1, float32[i]));
            int16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        }
        const bytes = new Uint8Array(int16.buffer);
        let binary = '';
        for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
        return btoa(binary);
    }

    voiceButton.addEventListener('click', async function() {
        if (isStopping || isStarting) return;

        if (!isAssetDownloaded('sherpa-onnx-sense-voice')) {
            showToast('语音识别模型未下载，请先到设置中下载');
            void switchPage('settings');
            return;
        }

        if (isListening) {
            isStopping = true;
            isListening = false;

            if (!workletNode) {
                cleanupAll();
                isStopping = false;
                voiceButton.classList.remove('voice-btn-recording');
                return;
            }

            workletNode.port.postMessage({ type: 'stop' });
            return;
        }

        isStarting = true;
        try {
            cleanupAll();
            pendingSamples = null;

            mediaStream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, sampleRate: 16000 } });
            audioContext = new AudioContext({ sampleRate: 16000 });
            await audioContext.resume();
            await audioContext.audioWorklet.addModule('/voice-processor.js');

            const source = audioContext.createMediaStreamSource(mediaStream);
            workletNode = new AudioWorkletNode(audioContext, 'voice-processor');

            workletNode.port.onmessage = async function(event: MessageEvent) {
                if (event.data.type === 'debug') return;
                if (event.data.type === 'data') {
                    const samples = event.data.samples as Float32Array;
                    cleanupAll();

                    if (!samples || samples.length === 0) {
                        isStopping = false;
                        voiceButton.classList.remove('voice-btn-recording');
                        return;
                    }

                    pendingSamples = samples;
                    try {
                        const b64 = floatToBase64Pcm(pendingSamples);
                        voiceButton.title = '识别中...';
                        const res = await fetch('/api/speech/recognize', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ audio: b64 })
                        });
                        const data = await res.json();
                        if (data.success && data.data) {
                            if (data.data.text) {
                                searchInput.value = data.data.text;
                                searchInput.focus();
                                voiceButton.title = '识别完成';
                            } else {
                                voiceButton.title = '未能识别，请再试一次';
                            }
                        }
                    } catch (e) {
                        console.error('语音识别失败:', e);
                    } finally {
                        isStopping = false;
                        voiceButton.classList.remove('voice-btn-recording');
                        voiceButton.title = '';
                        pendingSamples = null;
                    }
                }
            };

            source.connect(workletNode);

            workletNode.port.postMessage({ type: 'start' });
            isListening = true;
            isStopping = false;
            voiceButton.classList.add('voice-btn-recording');
            console.log('[voice] recording started');
        } catch (e: any) {
            console.error('录音启动失败:', e);
            voiceButton.title = '无法访问麦克风';
            isListening = false;
            cleanupAll();
        } finally {
            isStarting = false;
        }
    });
}

function hasChinese(text: string): boolean {
    return /[\u4e00-\u9fa5]/.test(text);
}

// 中文释义搜索：在词典中查找包含该中文的英文单词
async function searchChineseWords(keyword: string): Promise<void> {
    const resultDiv = document.getElementById('result');
    const translationContainer = document.getElementById('translation-container');
    const chineseResultDiv = document.getElementById('chinese-search-result') as HTMLElement;
    const listEl = chineseResultDiv?.querySelector('.chinese-search-list') as HTMLElement;

    if (resultDiv) resultDiv.classList.remove('result-visible');
    if (translationContainer) translationContainer.style.display = 'none';
    if (!chineseResultDiv || !listEl) return;

    chineseResultDiv.style.display = 'block';
    listEl.innerHTML = '<div class="chinese-search-loading">正在搜索...</div>';

    try {
        const data = await apiGet('/api/search-chinese?keyword=' + encodeURIComponent(keyword));
        if (data.success && data.data && data.data.length > 0) {
            listEl.innerHTML = data.data.map((item: any) => `
                <a href="#" class="chinese-search-item" data-word="${escapeHtml(item.word)}">
                    <span class="chinese-search-word">${escapeHtml(item.word)}</span>
                    <span class="chinese-search-meaning">${escapeHtml((item.translation || '').split('\n')[0])}</span>
                </a>
            `).join('');

            listEl.querySelectorAll('.chinese-search-item').forEach(el => {
                el.addEventListener('click', (e) => {
                    e.preventDefault();
                    const word = (e.currentTarget as HTMLElement).dataset.word;
                    if (word) {
                        const searchInput = document.getElementById('search-input') as HTMLInputElement;
                        if (searchInput) searchInput.value = word;
                        searchWord(word);
                    }
                });
            });
        } else {
            // 词典里搜不到，调翻译 API 兜底
            if (chineseResultDiv) chineseResultDiv.style.display = 'none';
            translateText(keyword);
            return;
        }
    } catch (error: unknown) {
        console.error('中文释义搜索失败:', error);
        listEl.innerHTML = '<div class="chinese-search-empty">搜索失败，请稍后重试</div>';
    }
}

// 先查词典，没有就翻译
export async function searchOrTranslate(text: string): Promise<void> {
    const resultDiv = document.getElementById('result');
    const translationContainer = document.getElementById('translation-container');
    const chineseResultDiv = document.getElementById('chinese-search-result');
    const wordElement = document.getElementById('word');
    const phoneticElement = document.getElementById('phonetic');
    const meaningsElement = document.getElementById('meanings');

    // 先隐藏之前的结果，不清空resultDiv的HTML结构
    if (wordElement) wordElement.textContent = '';
    if (phoneticElement) phoneticElement.textContent = '';
    if (meaningsElement) meaningsElement.innerHTML = '';
    if (translationContainer) translationContainer.classList.add('translation-hidden');
    if (chineseResultDiv) chineseResultDiv.style.display = 'none';

    const word = text.trim();

    // 含中文时走中文释义搜索
    if (hasChinese(word)) {
        console.log('检测到中文，走中文释义搜索:', word);
        recordSearchHistory(word);
        appState.studyStats.searchCount++;
        updateStudyStats();
        await searchChineseWords(word);
        return;
    }

    // 判断是不是句子（包含空格且单词数超过1个）
    const words = word.trim().split(/\s+/).filter(w => w.length > 0);
    const isSentence = words.length > 1;

    if (isSentence) {
        // 是句子，直接调用翻译
        console.log('检测到句子，直接调用翻译');
        translateText(word);
        return;
    }

    try {
        console.log('正在搜索单词:', word);
        const data = await apiGet('/api/search?word=' + encodeURIComponent(word));
        console.log('搜索API返回:', data);

        if (data.success && data.data) {
            console.log('找到单词，准备显示');
            // 找到了，处理并显示
            recordSearchHistory(word);
            appState.studyStats.searchCount++;
            updateStudyStats();

            let enhancedData = null;
            try {
                const enhancedResult = await apiGet('/api/enhanced?word=' + encodeURIComponent(word));
                if (enhancedResult.success) {
                    enhancedData = enhancedResult.data;
                }
            } catch (e: unknown) {
                console.error('获取增强信息失败:', e);
            }

            // 转换并显示
            const formattedData = convertApiDataToFrontendFormat(data.data);
            if (enhancedData) {
                formattedData.enhanced = enhancedData;
            }
            displayResult(formattedData);
        } else {
            // 没找到，调用翻译
            translateText(text);
        }
    } catch (error: unknown) {
        console.error('查询错误:', error);
        // 出错时也尝试翻译
        translateText(text);
    }
}

// 将API返回的数据转换为前端需要的格式
export function convertApiDataToFrontendFormat(apiData: {
    word?: string;
    phonetic?: string;
    definition?: string;
    translation?: string;
    from_dicts?: unknown[];
    tag?: string;
    exchange?: string;
}): WordData {
    const meanings = parseMeanings(apiData.translation, apiData.definition);

    return {
        word: apiData.word || '',
        phonetic: apiData.phonetic || '',
        meanings: meanings.length > 0 ? meanings : [{ part: '词组', definition: apiData.translation || '' }],
        fromDicts: (apiData.from_dicts || []) as string[],
        tags: apiData.tag || '',
        exchange: apiData.exchange || ''
    };
}

export async function searchWord(word: string): Promise<void> {
    console.log('searchWord 被调用:', word);
    try {
        // 查词前后台刷新单词本数据（不阻塞查词），避免在单词本页新建的单词本这里不显示
        void pageHandlers.loadWordbooks?.();

        const translationContainer = document.getElementById('translation-container');
        const chineseResultDiv = document.getElementById('chinese-search-result');
        if (translationContainer) translationContainer.classList.add('translation-hidden');
        if (chineseResultDiv) chineseResultDiv.style.display = 'none';

        // 含中文时走中文释义搜索
        if (hasChinese(word)) {
            recordSearchHistory(word);
            appState.studyStats.searchCount++;
            updateStudyStats();
            await searchChineseWords(word);
            return;
        }

        recordSearchHistory(word);

        appState.studyStats.searchCount++;
        updateStudyStats();

        const [searchResponse, enhancedResponse, examplesData] = await Promise.all([
            fetch('/api/search?word=' + encodeURIComponent(word)),
            fetch('/api/enhanced?word=' + encodeURIComponent(word)),
            apiGet('/api/examples?word=' + encodeURIComponent(word))
        ]);
        console.log('searchWord fetch 完成, searchResponse status:', searchResponse.status);

        const searchData = await searchResponse.json();

        if (searchData.success) {
            // 词典里有这个词（或词组），显示单词卡片
            const formattedData = convertApiDataToFrontendFormat(searchData.data);
            try {
                const enhancedData = await enhancedResponse.json();
                if (enhancedData.success) {
                    formattedData.enhanced = enhancedData.data;
                }
            } catch (e: unknown) {
                console.error('获取增强信息失败:', e);
            }
            try {
                if (examplesData.success && examplesData.data && examplesData.data.length > 0) {
                    formattedData.examples = examplesData.data;
                }
            } catch (e: unknown) {
                console.error('获取例句失败:', e);
            }
            displayResult(formattedData);
        } else {
            // 词典里没有，才调用翻译
            translateText(word);
        }
    } catch (error: unknown) {
        console.error('搜索单词时出错:', error);
        // 出错时也调用翻译
        translateText(word);
    }
}

// 构建增强信息HTML
export function buildEnhancedHtml(enhanced: {
    roots?: Array<{ root: string; info: { meaning?: string; class?: string; example?: string[] } }>;
    similar_words?: string[];
    resemble_groups?: Array<{ explanation: string[] }>;
}, word: string): string {
    let html = '';
    if (!enhanced) return html;

    if (enhanced.roots && enhanced.roots.length > 0) {
        html += '<div class="enhanced-section">';
        html += '<h4>🌱 词根/词缀</h4>';

        enhanced.roots.forEach((rootInfo: RootInfo) => {
            html += '<div class="root-info-card">';
            html += '<div class="root-name">' + rootInfo.root + '</div>';
            if (rootInfo.info.meaning) {
                html += '<div class="root-meaning">' + rootInfo.info.meaning + '</div>';
            }
            if (rootInfo.info.class) {
                html += '<div class="root-class">' + rootInfo.info.class + '</div>';
            }
            if (rootInfo.info.example && rootInfo.info.example.length > 0) {
                html += '<div class="root-examples">';
                html += '<strong>例词:</strong> ';
                rootInfo.info.example.forEach((example: string, idx: number) => {
                    if (idx > 0) html += ', ';
                    html += '<a href="#" onclick="g(\'jumpToWord\',\'' + escapeForJsString(example.toLowerCase()) + '\'); return false;" class="link-word">' + escapeHtml(example) + '</a>';
                });
                html += '</div>';
            }
            html += '</div>';
        });
        html += '</div>';
    }

    if (enhanced.similar_words && enhanced.similar_words.length > 0) {
        html += '<div class="enhanced-section">';
        html += '<h4>🔗 形近词/同义词</h4>';
        html += '<div>';
        enhanced.similar_words.forEach((w: string, idx: number) => {
            if (idx > 0) html += ', ';
            html += '<a href="#" onclick="g(\'jumpToWord\',\'' + escapeForJsString(w) + '\'); return false;" class="link-word">' + escapeHtml(w) + '</a>';
        });
        html += '</div>';

        if (enhanced.resemble_groups && enhanced.resemble_groups.length > 0) {
            enhanced.resemble_groups.forEach((group: ResembleGroup) => {
                html += '<div class="resemble-card">';
                group.explanation.forEach((exp: string) => {
                    html += '<div>' + exp + '</div>';
                });
                html += '</div>';
            });
        }
        html += '</div>';
    }

    return html;
}

export function displayResult(data: WordData): void {
    console.log('displayResult 被调用，数据:', data);
    const result = document.getElementById('result');
    const wordElement = document.getElementById('word');
    const phoneticElement = document.getElementById('phonetic');
    const meaningsElement = document.getElementById('meanings');

    console.log('找到的元素: result=', result, 'wordElement=', wordElement,
               'phoneticElement=', phoneticElement, 'meaningsElement=', meaningsElement);

    if (!result || !wordElement || !phoneticElement || !meaningsElement) {
        console.error('搜索结果显示元素未找到');
        return;
    }

    const wasSwitching = isWordJumping();
    const crossPage = isCrossPageJumping();
    if (wasSwitching) {
        result.classList.remove('word-switching');
        result.style.opacity = '0';
        result.style.transform = crossPage ? 'translateY(10px)' : 'scale(0.97) translateY(-6px)';
    }

    appState.currentSearchWord = data;

    const translationContainer = document.getElementById('translation-container');
    if (translationContainer) {
        translationContainer.style.display = 'none';
    }

    wordElement.textContent = data.word;
    if (data.phonetic) {
        phoneticElement.textContent = '/' + data.phonetic + '/';
    } else {
        phoneticElement.textContent = '';
    }

    // 构建标签HTML
    const tagMap: Record<string, string> = {
        'xx': '小学',
        'zk': '中考',
        'gk': '高考',
        'cet4': '四级',
        'cet6': '六级',
        'tem4': '专四',
        'tem8': '专八',
        'ky': '考研',
        'toefl': '托福',
        'ielts': '雅思',
        'gre': 'GRE',
        'coca': 'COCA',
        'coca20000': 'COCA',
        'a-level': 'A-Level'
    };
    let tagsHtml = '';
    if (data.tags) {
        const tags = normalizeDisplayTags(data.tags);
        if (tags.length > 0) {
            tagsHtml = '<div class="tag-container">';
            tags.forEach((tag: string) => {
                const displayName = tagMap[tag] || tag;
                let bgClass = 'tag-cat-default';
                if (tag === 'cet4' || tag === 'cet6') bgClass = 'tag-cat-cet';
                else if (tag === 'tem4' || tag === 'tem8') bgClass = 'tag-cat-tem';
                else if (tag === 'ky') bgClass = 'tag-cat-ky';
                else if (tag === 'zk' || tag === 'gk' || tag === 'xx') bgClass = 'tag-cat-zk';
                else if (tag === 'toefl' || tag === 'ielts') bgClass = 'tag-cat-toefl';
                else if (tag === 'gre') bgClass = 'tag-cat-gre';
                else if (tag === 'coca' || tag === 'coca20000') bgClass = 'tag-cat-coca';

                tagsHtml += '<span class="tag-badge ' + bgClass + '">' + displayName + '</span>';
            });
            tagsHtml += '</div>';
        }
    }

    const tagsElement = document.getElementById('tags');
    if (tagsElement) {
        tagsElement.innerHTML = tagsHtml;
    }

    let exchangeHtml = '';
    if (data.exchange) {
        const exchangeMap: Record<string, string> = {
            'p': '过去式', 'd': '过去分词', 'i': '现在分词',
            '3': '第三人称单数', 'r': '比较级', 't': '最高级', 's': '复数'
        };
        const parts = data.exchange.split('/').filter((p: string) => p.includes(':'));
        const currentWord = data.word.toLowerCase();
        // 收集有效的词形变化
        const validExchanges: { name: string; value: string }[] = [];
        let baseForm = '';
        parts.forEach((part: string) => {
            const [key, ...valueParts] = part.split(':');
            const value = valueParts.join(':');
            const name = exchangeMap[key] || key;
            if (name && value && key !== '0' && key !== '1' && value.toLowerCase() !== currentWord) {
                validExchanges.push({ name, value });
            }
            // 记录原型（用于派生词显示）
            if (key === '0' && value.toLowerCase() !== currentWord) {
                baseForm = value;
            }
        });
        // 只有有效内容时才生成HTML
        if (validExchanges.length > 0 || baseForm) {
            exchangeHtml = '<div class="exchange-box">';
            exchangeHtml += '<div class="exchange-title">词形变化</div>';
            if (baseForm) {
                exchangeHtml += '<div class="exchange-item">';
                exchangeHtml += '<span class="exchange-label">原型:</span>';
                exchangeHtml += '<a href="#" onclick="g(\'jumpToWord\',\'' + escapeForJsString(baseForm) + '\'); return false;" class="exchange-link">' + escapeHtml(baseForm) + '</a>';
                exchangeHtml += '</div>';
            }
            validExchanges.forEach(ex => {
                exchangeHtml += '<div class="exchange-item">';
                exchangeHtml += '<span class="exchange-label">' + ex.name + ':</span>';
                exchangeHtml += '<a href="#" onclick="g(\'jumpToWord\',\'' + escapeForJsString(ex.value) + '\'); return false;" class="exchange-link">' + escapeHtml(ex.value) + '</a>';
                exchangeHtml += '</div>';
            });
            exchangeHtml += '</div>';
        }
    }

    let isInWordlist = false;
    if (appState.lastWordbookSelector && appState.wordbooks[appState.lastWordbookSelector]) {
        isInWordlist = appState.wordbooks[appState.lastWordbookSelector].some(item =>
            (typeof item === 'string' ? item : item.word) === data.word
        );
    }
    const isInFavorites = appState.favorites.some(item => typeof item === 'object' && (item as any).word === data.word);

    let wordbookOptions = '<option value="" disabled selected>选择单词本</option>';
    for (const name in appState.wordbooks) {
        if (name.startsWith('sys_')) continue;
        const wordCount = Array.isArray(appState.wordbooks[name]) ? appState.wordbooks[name].length : 0;
        wordbookOptions += '<option value="' + name + '"' + (appState.lastWordbookSelector === name ? ' selected' : '') + '>' + name + ' (' + wordCount + '词)</option>';
    }

    // 构建增强信息HTML
    const enhancedHtml = buildEnhancedHtml(data.enhanced, data.word);

    let meaningsHtml = '';
    data.meanings.forEach((meaning: WordMeaning) => {
        meaningsHtml += '<div class="meaning-item">';

        // 解析词性和领域标签（如 [医]、[经] 等）
        let partHtml = '';
        let defHtml = meaning.definition || '';

        // 把 API 返回的字面量换行符和真实换行转成 <br>
        defHtml = normalizeNewlines(defHtml).replace(/\n/g, '<br>');

        // 提取定义中的领域标签
        const domainTagMatch = defHtml.match(/^\[([^\]]+)\]\s*/);
        let domainTagHtml = '';
        if (domainTagMatch) {
            const domainTag = domainTagMatch[1];
            const domainColors: Record<string, string> = {
                '医': '#e74c3c', '经': '#f39c12', '法': '#3498db',
                '计': '#2ecc71', '心': '#9b59b6', '生': '#1abc9c',
                '化': '#e67e22', '物': '#27ae60', '地': '#34495e',
                '科': '#7f8c8d', '电': '#2980b9', '机': '#16a085'
            };
            const tagColor = domainColors[domainTag] || '#3498db';
            domainTagHtml = '<div class="part-of-speech" style="background:' + tagColor + '20;color:' + tagColor + '">[' + domainTag + ']</div>';
            defHtml = defHtml.replace(/^\[[^\]]+\]\s*/, '');
        }

        if (meaning.part && meaning.part.trim() !== '') {
            partHtml = '<div class="part-of-speech">' + meaning.part + '</div>';
        }

        // 领域标签和词性在同一行显示
        if (domainTagHtml || partHtml) {
            meaningsHtml += '<div class="meaning-tag-row">';
            if (partHtml) meaningsHtml += partHtml;
            if (domainTagHtml) meaningsHtml += domainTagHtml;
            meaningsHtml += '</div>';
        }

        meaningsHtml += '<div class="definition">' + defHtml + '</div>';
        meaningsHtml += '</div>';
    });

    if (exchangeHtml) {
        meaningsHtml += exchangeHtml;
    }

    let buttonsHtml = '';
    buttonsHtml += '<div class="result-actions">';
    buttonsHtml += '<select id="wordbook-selector" class="result-wb-select">';
    buttonsHtml += wordbookOptions;
    buttonsHtml += '</select>';
    buttonsHtml += '<button class="favorites-btn" onclick="event.stopPropagation(); g(\'playPronunciation\',\'us\',\'' + escapeForJsString(data.word) + '\')">美式发音</button>';
    buttonsHtml += '<button class="favorites-btn" onclick="event.stopPropagation(); g(\'playPronunciation\',\'uk\',\'' + escapeForJsString(data.word) + '\')">英式发音</button>';
    buttonsHtml += '<button class="favorites-btn ' + (isInWordlist ? 'active' : '') + '" id="add-to-wordlist">';
    buttonsHtml += isInWordlist ? '已在单词本' : '加入单词本';
    buttonsHtml += '</button>';
    buttonsHtml += '<button class="favorites-btn ' + (isInFavorites ? 'active' : '') + '" id="add-to-favorites">';
    buttonsHtml += isInFavorites ? '已收藏' : '加入收藏';
    buttonsHtml += '</button>';
    buttonsHtml += '</div>';

    // 构建例句HTML
    let examplesHtml = '';
    if (data.examples && data.examples.length > 0) {
        examplesHtml = '<div class="examples-section enhanced-section">';
        examplesHtml += '<h3 class="examples-section-header"><span>📖</span> 例句</h3>';
        examplesHtml += '<div class="examples-list">';

        data.examples.forEach((example: ExampleData) => {
            const langLabel = example.lang === 'cmn' ? '中文' : example.lang === 'eng' ? '英文' : example.lang.toUpperCase();
            const langColor = example.lang === 'cmn' ? '#e74c3c' : example.lang === 'eng' ? '#3498db' : '#9b59b6';

            examplesHtml += '<div class="example-card" style="--lang-color: ' + langColor + ';">';
            examplesHtml += '<div class="example-card-header">';
            examplesHtml += '<span class="lang-badge">' + langLabel + '</span>';
            examplesHtml += '</div>';

            let processedText = example.text;
            if (example.lang === 'eng') {
                processedText = example.text.replace(/([a-zA-Z]+(?:'[a-zA-Z]+)?)/g, function(match: string) {
                    return '<a href="#" onclick="g(\'jumpToWord\',\'' + escapeForJsString(match.toLowerCase()) + '\'); return false;" class="clickable-word">' + escapeHtml(match) + '</a>';
                });
            }

            examplesHtml += '<div class="example-text">' + processedText + '</div>';
            if (example.translation) {
                examplesHtml += '<div class="example-translation">';
                examplesHtml += '<span class="example-text-zh-label">中文:</span>' + example.translation;
                examplesHtml += '</div>';
            }
            examplesHtml += '</div>';
        });

        examplesHtml += '</div></div>';
    } else if (!isAssetDownloaded('examples.db')) {
        examplesHtml = createMissingAssetPrompt('例句库');
    }

    meaningsElement.innerHTML = meaningsHtml + buttonsHtml + enhancedHtml + examplesHtml;

    result.classList.add('result-visible');

    const addToWordlistBtn = document.getElementById('add-to-wordlist');
    if (addToWordlistBtn) {
        addToWordlistBtn.addEventListener('click', function() {
            void toggleWordlist(data);
        });
    }

    const addToFavoritesBtn = document.getElementById('add-to-favorites');
    if (addToFavoritesBtn) {
        addToFavoritesBtn.addEventListener('click', function() {
            toggleFavorites(data);
        });
    }

    const wordbookSelector = document.getElementById('wordbook-selector') as HTMLSelectElement;
    if (wordbookSelector) {
        wordbookSelector.addEventListener('change', function() {
            appState.lastWordbookSelector = this.value;
            localStorage.setItem('lastWordbookSelector', appState.lastWordbookSelector);
            updateAddToWordlistButton();
        });
    }

    if (wasSwitching) {
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                result.style.opacity = '';
                result.style.transform = '';
                animateResultShow(result);
            });
        });
        onWordJumpDone();
    }

    // 结果渲染后滚动到结果区域，避开顶部navbar
    setTimeout(() => {
        const el = document.getElementById('result');
        if (el && el.classList.contains('result-visible')) {
            const navbar = document.getElementById('navbar');
            const offset = navbar ? navbar.getBoundingClientRect().height + 12 : 80;
            const top = el.getBoundingClientRect().top + window.scrollY - offset;
            window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
        }
    }, 100);
}

export function initKeyboardShortcuts(): void {
    document.addEventListener('keyup', function(e: KeyboardEvent) {
        if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
            return;
        }

        if (document.querySelector('.modal-overlay[style*="flex"], .modal-overlay.modal-visible')) {
            return;
        }

        const dictionaryPage = document.getElementById('dictionary-page');
        if (dictionaryPage && !dictionaryPage.classList.contains('active')) {
            return;
        }

        if (!appState.currentSearchWord) {
            return;
        }

        loadSettings();

        if (e.key === appState.settings.addToWordlistKey) {
            e.preventDefault();
            void addCurrentToWordlist();
        }

        if (e.key === appState.settings.addToFavoritesKey) {
            e.preventDefault();
            addCurrentToFavorites();
        }
    });
}

export async function addToCustomWordbook(wordbookName: string, word: WordData | string): Promise<void> {
    try {
        const wordData = typeof word === 'string' ? { word: word } : word;
        const targetWord = wordData.word;
        if (!targetWord) {
            showToast('单词为空，添加失败', 'error');
            return;
        }

        const response = await fetch('/api/wordbook/add', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                wordbook: wordbookName,
                word: targetWord
            })
        });

        const data = await response.json();

        if (data.success) {
            appState.wordbooks = { ...(data.data && data.data.wordbooks) || {} };
            localStorage.setItem('wordbooks', JSON.stringify(appState.wordbooks));
            appState.studyStats.todayWords++;
            updateStudyStats();
            updateAllWordbookSelectors();
            showToast(`已添加到 ${wordbookName}`, 'success');
        } else {
            showToast((data.error && data.error.message) || '添加失败', 'error');
        }
    } catch (e: unknown) {
        console.error('添加到自定义单词本失败:', e);
        showToast('添加失败', 'error');
    }
}

// 将当前查词加入单词本
export async function addCurrentToWordlist(): Promise<void> {
    if (!appState.currentSearchWord) return;

    const wordbookSelector = document.getElementById('wordbook-selector') as HTMLSelectElement;
    const selectedWordbook = wordbookSelector ? wordbookSelector.value : '';

    if (!selectedWordbook) {
        showToast('请先到单词本页面创建单词本', 'info');
        return;
    }

    await addToCustomWordbook(selectedWordbook, appState.currentSearchWord);

    // 记住当前使用的单词本，返回词典页时能恢复选中状态
    appState.lastWordbookSelector = selectedWordbook;
    localStorage.setItem('lastWordbookSelector', selectedWordbook);

    updateAddToWordlistButton();
}

// 将当前查词加入收藏
export function addCurrentToFavorites(): void {
    if (!appState.currentSearchWord) return;

    const isInFavorites = appState.favorites.some(item => typeof item === 'object' && (item as any).word === appState.currentSearchWord.word);
    if (!isInFavorites) {
        appState.favorites.push(appState.currentSearchWord);
        localStorage.setItem('favorites', JSON.stringify(appState.favorites));
        appState.studyStats.todayWords++;
        updateStudyStats();
        showToast('已添加到收藏', 'success');
    } else {
        showToast('该单词已在收藏中', 'info');
    }

    updateAddToFavoritesButton();
}

export function updateAddToWordlistButton(): void {
    const addToWordlistBtn = document.getElementById('add-to-wordlist');
    if (addToWordlistBtn && appState.currentSearchWord) {
        const wordbookSelector = document.getElementById('wordbook-selector') as HTMLSelectElement;
        if (!wordbookSelector) return;
        const selectedWordbook = wordbookSelector.value;

        let isInWordlist = false;

        if (selectedWordbook && appState.wordbooks[selectedWordbook]) {
            isInWordlist = appState.wordbooks[selectedWordbook].some(item =>
                (typeof item === 'string' ? item : item.word) === appState.currentSearchWord.word
            );
        }

        addToWordlistBtn.classList.toggle('active', isInWordlist);
        addToWordlistBtn.textContent = isInWordlist ? '已在单词本' : '加入单词本';
    }
}

// 返回词典页时刷新单词本下拉框（在单词本页新建的单词本能立即显示）
export async function refreshResultWordbookSelector(): Promise<void> {
    await pageHandlers.loadWordbooks?.();
    const wordbookSelector = document.getElementById('wordbook-selector') as HTMLSelectElement;
    if (!wordbookSelector) return;

    let optionsHtml = '<option value="" disabled>选择单词本</option>';
    for (const name in appState.wordbooks) {
        if (name.startsWith('sys_')) continue;
        const wordCount = Array.isArray(appState.wordbooks[name]) ? appState.wordbooks[name].length : 0;
        optionsHtml += `<option value="${name}">${name} (${wordCount}词)</option>`;
    }
    wordbookSelector.innerHTML = optionsHtml;

    if (appState.lastWordbookSelector && appState.wordbooks[appState.lastWordbookSelector]) {
        wordbookSelector.value = appState.lastWordbookSelector;
    } else {
        wordbookSelector.value = '';
    }

    updateAddToWordlistButton();
}

export function updateAddToFavoritesButton(): void {
    const addToFavoritesBtn = document.getElementById('add-to-favorites');
    if (addToFavoritesBtn && appState.currentSearchWord) {
        const isInFavorites = appState.favorites.some(item => typeof item === 'object' && (item as any).word === appState.currentSearchWord.word);
        addToFavoritesBtn.classList.toggle('active', isInFavorites);
        addToFavoritesBtn.textContent = isInFavorites ? '已收藏' : '加入收藏';
    }
}


export function toggleSentenceFavorites(): void {
    if (!appState.currentSentence) return;

    const text = appState.currentSentence.text;
    const translation = appState.currentSentence.translation;

    const index = appState.favorites.findIndex(item => {
        const itemText = typeof item === 'string' ? item : ((item as any).word || (item as any).text);
        return itemText === text;
    });

    const sentenceFavBtn = document.getElementById('add-sentence-to-favorites') as HTMLElement;

    if (index === -1) {
        appState.favorites.push({ text: text, translation: translation, type: 'sentence', timestamp: Date.now() });
        localStorage.setItem('favorites', JSON.stringify(appState.favorites));
        showToast('已收藏句子', 'success');
    } else {
        appState.favorites.splice(index, 1);
        localStorage.setItem('favorites', JSON.stringify(appState.favorites));
        showToast('已取消收藏', 'info');
    }

    updateSentenceButtons();
}

export function toggleSentenceWordbook(): void {
    if (!appState.currentSentence) return;

    showSentenceWordbookModal();
}

export function showSentenceWordbookModal(): void {
    if (!appState.currentSentence) return;

    // 构建可选单词本列表（排除系统单词本和保留名称）
    const RESERVED_NAMES = new Set(['wordlist', 'favorites', 'errorbook']);
    const customWordbooks: Array<{ name: string; words: WordbookItem[] }> = [];

    for (const name in appState.wordbooks) {
        if (!name.startsWith('sys_') && !RESERVED_NAMES.has(name)) {
            customWordbooks.push({ name: name, words: appState.wordbooks[name] || [] });
        }
    }

    if (customWordbooks.length === 0) {
        showToast('请先创建自定义单词本', 'info');
        return;
    }

    // 构建选项HTML
    const optionsHtml = customWordbooks.map(wb => {
        const wordCount = Array.isArray(wb.words) ? wb.words.length : 0;
        return `<option value="${escapeHtml(wb.name)}">${escapeHtml(wb.name)} (${wordCount}词)</option>`;
    }).join('');

    const modalHtml = `
        <div id="sentence-wordbook-modal" class="modal-overlay" style="position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 10000; display: flex; align-items: center; justify-content: center; opacity: 0;">
            <div class="modal-content" style="background: var(--bg-white); border-radius: 12px; padding: 24px; width: 400px; max-width: 90%; box-shadow: 0 4px 20px rgba(0,0,0,0.15); transform: scale(0.92) translateY(10px); opacity: 0;">
                <h3 style="margin: 0 0 16px 0; color: var(--text-dark);">选择单词本</h3>
                <p style="margin: 0 0 12px 0; font-size: 13px; color: var(--text-gray);">
                    将句子添加到：
                </p>
                <select id="sentence-wordbook-select" class="sentence-wb-select" style="width: 100%; padding: 8px 40px 8px 12px; border: 2px solid var(--border-color); border-radius: 6px; background-color: var(--bg-white); color: var(--text-dark); font-size: 14px; margin-bottom: 16px; outline: none;">
                    <option value="">-- 请选择单词本 --</option>
                    ${optionsHtml}
                </select>
                <div style="display: flex; gap: 12px; justify-content: flex-end;">
                    <button id="sentence-wordbook-cancel" class="btn-modal-cancel" style="padding: 8px 20px;">取消</button>
                    <button id="sentence-wordbook-confirm" class="btn-modal-confirm" style="padding: 8px 20px;">确认添加</button>
                </div>
            </div>
        </div>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHtml);

    const modal = document.getElementById('sentence-wordbook-modal') as HTMLElement;
    const modalContent = modal.querySelector('.modal-content') as HTMLElement;
    const cancelBtn = document.getElementById('sentence-wordbook-cancel') as HTMLElement;
    const confirmBtn = document.getElementById('sentence-wordbook-confirm') as HTMLElement;
    const selectEl = document.getElementById('sentence-wordbook-select') as HTMLSelectElement;

    // 触发进入动画
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            modal.style.opacity = '1';
            modal.style.transition = 'opacity 0.25s ease';
            if (modalContent) {
                modalContent.style.transform = 'scale(1) translateY(0)';
                modalContent.style.opacity = '1';
                modalContent.style.transition = 'transform 0.28s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.2s ease';
            }
        });
    });

    function closeSentenceModal(): void {
        modal.style.opacity = '0';
        if (modalContent) {
            modalContent.style.transform = 'scale(0.92) translateY(10px)';
            modalContent.style.opacity = '0';
        }
        setTimeout(() => {
            if (modal.parentNode) modal.parentNode.removeChild(modal);
        }, 280);
    }

    cancelBtn.onclick = closeSentenceModal;

    modal.onclick = function(e: MouseEvent) {
        if (e.target === modal) {
            closeSentenceModal();
        }
    };

    confirmBtn.onclick = function() {
        const selectedWordbook = selectEl.value;
        if (!selectedWordbook) {
            showToast('请选择单词本', 'info');
            return;
        }

        const sentence = appState.currentSentence.text;

        if (!appState.wordbooks[selectedWordbook]) {
            appState.wordbooks[selectedWordbook] = [];
        }

        const exists = appState.wordbooks[selectedWordbook].some(item =>
            (typeof item === 'string' ? item : item.word) === sentence
        );

        if (!exists) {
            void addToCustomWordbook(selectedWordbook, sentence);
        } else {
            showToast(`该句子已在 "${selectedWordbook}" 中`, 'info');
        }

        closeSentenceModal();
        updateSentenceButtons();
    };
}

export function bindSentenceButtonEvents(): void {
    const sentenceFavBtn = document.getElementById('add-sentence-to-favorites');
    const sentenceWbBtn = document.getElementById('add-sentence-to-wordbook');
    const wordbookSelect = document.getElementById('sentence-wordbook-select-inline') as HTMLSelectElement;

    if (sentenceFavBtn) {
        sentenceFavBtn.onclick = function() { toggleSentenceFavorites(); };
    }
    if (wordbookSelect) {
        wordbookSelect.onchange = function() {
            localStorage.setItem('lastSentenceWordbook', wordbookSelect.value);
            updateSentenceButtons();
        };
    }
    if (sentenceWbBtn) {
        sentenceWbBtn.onclick = function() {
            if (!wordbookSelect || !wordbookSelect.value) {
                showToast('请先选择单词本', 'info');
                return;
            }
            const selectedWordbook = wordbookSelect.value;
            const sentence = appState.currentSentence.text;

            if (!appState.wordbooks[selectedWordbook]) {
                appState.wordbooks[selectedWordbook] = [];
            }

            const exists = appState.wordbooks[selectedWordbook].some(item =>
                (typeof item === 'string' ? item : item.word) === sentence
            );

            if (!exists) {
                void addToCustomWordbook(selectedWordbook, sentence);
                sentenceWbBtn.classList.add('active');
                sentenceWbBtn.textContent = '已在单词本';
            } else {
                appState.wordbooks[selectedWordbook] = appState.wordbooks[selectedWordbook].filter(item =>
                    (typeof item === 'string' ? item : item.word) !== sentence
                );
                localStorage.setItem('wordbooks', JSON.stringify(appState.wordbooks));
                showToast(`已从 "${selectedWordbook}" 移除`, 'info');
                sentenceWbBtn.classList.remove('active');
                sentenceWbBtn.textContent = '加入单词本';
            }

            updateAllWordbookSelectors();
        };
    }
}

export function updateSentenceButtons(): void {
    if (!appState.currentSentence) return;

    const sentence = appState.currentSentence.text;
    const sentenceWbBtn = document.getElementById('add-sentence-to-wordbook');
    const sentenceFavBtn = document.getElementById('add-sentence-to-favorites');
    const wordbookSelect = document.getElementById('sentence-wordbook-select-inline') as HTMLSelectElement;

    if (sentenceWbBtn && wordbookSelect) {
        const selectedWordbook = wordbookSelect.value;
        let isInWordbook = false;

        if (selectedWordbook && appState.wordbooks[selectedWordbook]) {
            isInWordbook = appState.wordbooks[selectedWordbook].some(item =>
                (typeof item === 'string' ? item : item.word) === sentence
            );
        }

        sentenceWbBtn.classList.toggle('active', isInWordbook);
        sentenceWbBtn.textContent = isInWordbook ? '已在单词本' : '加入单词本';
    }

    if (sentenceFavBtn) {
        const isInFavorites = appState.favorites.some(item => {
            const itemText = typeof item === 'string' ? item : ((item as any).word || (item as any).text);
            return itemText === sentence;
        });
        sentenceFavBtn.classList.toggle('active', isInFavorites);
        sentenceFavBtn.textContent = isInFavorites ? '已收藏' : '加入收藏';
    }
}

export async function toggleWordlist(data: { word: string }): Promise<void> {
    const word = data.word;
    const wordbookSelector = document.getElementById('wordbook-selector') as HTMLSelectElement;
    const selectedWordbook = wordbookSelector ? wordbookSelector.value : '';

    if (!selectedWordbook) {
        showToast('请先到单词本页面创建单词本', 'info');
        return;
    }

    if (selectedWordbook) {
        appState.lastWordbookSelector = selectedWordbook;
        localStorage.setItem('lastWordbookSelector', selectedWordbook);
    }

    let isInWordbook = false;

    if (appState.wordbooks[selectedWordbook]) {
        isInWordbook = appState.wordbooks[selectedWordbook].some(item =>
            (typeof item === 'string' ? item : item.word) === word
        );
    }

    const endpoint = isInWordbook ? '/api/wordbook/remove' : '/api/wordbook/add';
    try {
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                wordbook: selectedWordbook,
                word: word
            })
        });

        const resData = await response.json();

        if (resData.success) {
            appState.wordbooks = { ...(resData.data && resData.data.wordbooks) || {} };
            localStorage.setItem('wordbooks', JSON.stringify(appState.wordbooks));

            const nowInWordbook = !!(appState.wordbooks[selectedWordbook] && appState.wordbooks[selectedWordbook].some(item =>
                (typeof item === 'string' ? item : item.word) === word
            ));

            showToast(nowInWordbook ? `已添加到 ${selectedWordbook}` : `已从 ${selectedWordbook} 移除`, nowInWordbook ? 'success' : 'info');
            const addToWordlistBtn = document.getElementById('add-to-wordlist');
            if (addToWordlistBtn) {
                addToWordlistBtn.classList.toggle('active', nowInWordbook);
                addToWordlistBtn.textContent = nowInWordbook ? '已在单词本' : '加入单词本';
            }

            if (nowInWordbook && !isInWordbook) {
                appState.studyStats.todayWords++;
                updateStudyStats();
            }
        } else {
            showToast((resData.error && resData.error.message) || '操作失败', 'error');
        }
    } catch (e: unknown) {
        console.error('单词本操作失败:', e);
        showToast('操作失败', 'error');
    }

    updateWordlistDisplay();
    updateAllWordbookSelectors();
}

export function toggleFavorites(data: { word: string }): void {
    const word = data.word;
    const index = appState.favorites.findIndex(item => typeof item === 'object' && (item as any).word === word);
    const addToFavoritesBtn = document.getElementById('add-to-favorites') as HTMLElement;

    if (index === -1) {
        appState.favorites.push(data as unknown as WordData);
        localStorage.setItem('favorites', JSON.stringify(appState.favorites));
        if (addToFavoritesBtn) {
            addToFavoritesBtn.classList.add('active');
            addToFavoritesBtn.textContent = '已收藏';
        }
        showToast('已添加到收藏', 'success');

        appState.studyStats.todayWords++;
        updateStudyStats();
    } else {
        // 从收藏移除
        appState.favorites.splice(index, 1);
        localStorage.setItem('favorites', JSON.stringify(appState.favorites));
        if (addToFavoritesBtn) {
            addToFavoritesBtn.classList.remove('active');
            addToFavoritesBtn.textContent = '加入收藏';
        }
        showToast('已从收藏移除', 'info');
    }

    updateFavoritesDisplay();
}

export function updateWordlistDisplay(): void {
    const wordlistItems = document.getElementById('wordlist-items');
    if (wordlistItems) (wordlistItems.parentElement as HTMLElement).style.display = 'none';
}

// 记录查词历史
export function recordSearchHistory(word: string): void {
    if (!word || word.trim() === '') {
        return;
    }

    let searchHistory = JSON.parse(localStorage.getItem('searchHistory') || '[]');

    searchHistory = searchHistory.filter(item => item !== word);

    searchHistory.unshift(word);

    // 限制历史记录数量
    const maxHistoryCount = appState.settings.searchHistoryCount || 20;
    if (searchHistory.length > maxHistoryCount) {
        searchHistory = searchHistory.slice(0, maxHistoryCount);
    }

    localStorage.setItem('searchHistory', JSON.stringify(searchHistory));

    showSearchHistory();
}

export function showSearchHistory(): void {
    const historyItems = document.getElementById('search-history-items');
    const historyEmpty = document.getElementById('search-history-empty');

    if (!historyItems || !historyEmpty) {
        return;
    }

    const searchHistory = JSON.parse(localStorage.getItem('searchHistory') || '[]');

    const signature = `${searchHistory.length}|${searchHistory.join(',')}`;
    if (signature === lastSearchHistorySignature) return;
    lastSearchHistorySignature = signature;

    if (searchHistory.length === 0) {
        historyItems.innerHTML = '';
        historyEmpty.style.display = 'block';
    } else {
        historyEmpty.style.display = 'none';
        historyItems.innerHTML = searchHistory.map((word: string) => {
            const safeWord = escapeHtml(word);
            return `
                <div class="search-history-row">
                    <a href="#" class="history-link" data-query="${safeWord}">${safeWord}</a>
                    <button class="history-remove" data-query="${safeWord}">×</button>
                </div>
            `;
        }).join('');

        historyItems.querySelectorAll('.history-link').forEach(link => {
            link.addEventListener('click', function(e) {
                e.preventDefault();
                const query = (e.currentTarget as HTMLElement).dataset.query;
                if (query) navigateToWord(query);
            });
        });

        historyItems.querySelectorAll('.history-remove').forEach(btn => {
            btn.addEventListener('click', function(e) {
                e.stopPropagation();
                const query = (e.currentTarget as HTMLElement).dataset.query;
                if (query) removeFromSearchHistory(query);
            });
        });
    }
}

// 从查词历史中移除单词
export function removeFromSearchHistory(word: string): void {
    let searchHistory = JSON.parse(localStorage.getItem('searchHistory') || '[]');
    searchHistory = searchHistory.filter(item => item !== word);
    localStorage.setItem('searchHistory', JSON.stringify(searchHistory));
    showSearchHistory();
}



export async function translateText(text: string): Promise<void> {
    const searchInput = document.getElementById('search-input') as HTMLInputElement;
    const translationResult = document.getElementById('translation-result') as HTMLElement;
    const translationContainer = document.getElementById('translation-container') as HTMLElement;
    const wordElement = document.getElementById('word');
    const phoneticElement = document.getElementById('phonetic');
    const meaningsElement = document.getElementById('meanings');

    if (!text) {
        text = searchInput.value.trim();
    }

    if (!text) {
        translationResult.innerHTML = '<p class="translation-error">请输入要翻译的文本</p>';
        return;
    }

    // 隐藏单词结果容器，显示翻译容器
    const resultDiv = document.getElementById('result');
    if (resultDiv) {
        resultDiv.classList.remove('result-visible');
        resultDiv.style.opacity = '';
        resultDiv.style.transform = '';
    }
    translationContainer.classList.remove('translation-hidden');
    translationContainer.style.display = 'block';

    translationResult.innerHTML = '<p class="translation-loading">正在翻译...</p>';

    try {
        // 句子类词条请求翻译时首字母小写，提高准确性并复用缓存
        const apiText = text.charAt(0).toLowerCase() + text.slice(1);
        console.log('调用翻译API:', apiText);
        const data = await apiTranslate(apiText);
        console.log('翻译API返回:', data);

        if (data.success) {
            const displayText = normalizeCaseByType(text);
            const isSentence = text.trim().split(/\s+/).filter(w => w.length > 0).length > 1;
            // 中译英时，发音用英文译文；英译中时，发音用原文英文
            const pronounceText = hasChinese(text) ? (data.translation || displayText) : displayText;

            // 将原文中的英文单词转为可点击的链接
            const clickableOriginalText = makeWordsClickable(displayText);

            const isSentenceInFavorites = appState.favorites.some(item => {
                const itemText = typeof item === 'string' ? item : ((item as any).word || (item as any).text);
                return itemText === text || itemText === displayText;
            });

            let resultHtml = `<div class="translation-original">
                <strong>原文：</strong>${clickableOriginalText}
                <div class="result-actions">
                    <select id="sentence-wordbook-select-inline" class="result-wb-select">
                        <option value="" disabled selected>选择单词本</option>
                    </select>
                    <button data-action="play-sentence" data-type="us" data-text="${escapeHtml(pronounceText)}"
                            class="favorites-btn">
                        美式发音
                    </button>
                    <button data-action="play-sentence" data-type="uk" data-text="${escapeHtml(pronounceText)}"
                            class="favorites-btn">
                        英式发音
                    </button>
                    <button id="add-sentence-to-wordbook" class="favorites-btn">
                        加入单词本
                    </button>
                    <button id="add-sentence-to-favorites" class="favorites-btn ${isSentenceInFavorites ? 'active' : ''}">
                        ${isSentenceInFavorites ? '已收藏' : '加入收藏'}
                    </button>
                </div>
            </div>`;

            // 单个单词 fallback 到翻译时，也走释义解析，修复括号和行内词性
            let translationHtml = '';
            if (!isSentence && data.translation) {
                const meanings = parseMeanings(data.translation, '');
                if (meanings.length > 0) {
                    translationHtml = meanings.map((m: any) => {
                        const part = m.part && m.part !== '词组' ? `<strong>${m.part}</strong> ` : '';
                        return `${part}${m.definition}`;
                    }).join('<br>');
                }
            }
            if (!translationHtml) {
                translationHtml = formatDefinitionHtml(data.translation);
            }
            resultHtml += `<p><strong>翻译：</strong>${translationHtml}</p>`;
            if (data.cached) {
                resultHtml += '<p class="translation-cached">（来自缓存）</p>';
            }
            translationResult.innerHTML = resultHtml;

            translationResult.querySelectorAll<HTMLElement>('button[data-action="play-sentence"]').forEach(btn => {
                btn.addEventListener('click', () => {
                    const type = btn.dataset.type || 'us';
                    const sentence = btn.dataset.text || '';
                    if (sentence) getRegistry().playSentencePronunciation(type, sentence);
                });
            });

            // 存储当前句子
            appState.currentSentence = { text: displayText, translation: data.translation };

            // 填充单词本下拉框
            const wordbookSelect = document.getElementById('sentence-wordbook-select-inline') as HTMLSelectElement;
            if (wordbookSelect) {
                const RESERVED_NAMES = new Set(['wordlist', 'favorites', 'errorbook']);
                const customWordbooks: Array<{ name: string; words: WordbookItem[] }> = [];
                for (const name in appState.wordbooks) {
                    if (!name.startsWith('sys_') && !RESERVED_NAMES.has(name)) {
                        customWordbooks.push({ name: name, words: appState.wordbooks[name] || [] });
                    }
                }

                wordbookSelect.innerHTML = `<option value="" disabled>选择单词本</option>`;
                customWordbooks.forEach(wb => {
                    const wordCount = Array.isArray(wb.words) ? wb.words.length : 0;
                    wordbookSelect.innerHTML += `<option value="${escapeHtml(wb.name)}">${escapeHtml(wb.name)} (${wordCount}词)</option>`;
                });

                // 只有一个单词本时默认选中，不用手动选
                if (customWordbooks.length === 1) {
                    wordbookSelect.value = customWordbooks[0].name;
                } else {
                    // 恢复上次选择
                    const savedWordbook = localStorage.getItem('lastSentenceWordbook');
                    if (savedWordbook && wordbookSelect.querySelector(`option[value="${escapeHtml(savedWordbook)}"]`)) {
                        wordbookSelect.value = savedWordbook;
                    }
                }
            }

            bindSentenceButtonEvents();

            updateSentenceButtons();

            bindWordClickEvents(translationResult);

            // 结果渲染后滚动到翻译区域，避开顶部navbar
            setTimeout(() => {
                const el = document.getElementById('translation-container');
                if (el && el.style.display !== 'none') {
                    const navbar = document.getElementById('navbar');
                    const offset = navbar ? navbar.getBoundingClientRect().height + 12 : 80;
                    const top = el.getBoundingClientRect().top + window.scrollY - offset;
                    window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
                }
            }, 150);
        } else {
            translationResult.innerHTML = `<p class="translation-error">翻译失败：${data.error || '未知错误'}</p>`;
        }
    } catch (error: unknown) {
        translationResult.innerHTML = `<p class="translation-error">翻译失败：${(error as any).message || '未知错误'}</p>`;
    }
}

export function makeWordsClickable(text: string): string {
    return text.replace(/([a-zA-Z][a-zA-Z0-9'-]*)/g, function(match) {
        return `<span class="clickable-word" data-word="${match.toLowerCase()}">${match}</span>`;
    });
}

export function bindWordClickEvents(container: HTMLElement): void {
    const clickableWords = container.querySelectorAll('.clickable-word');
    clickableWords.forEach(function(wordElement) {
        wordElement.addEventListener('click', function() {
            const word = this.getAttribute('data-word');
            if (word) {
                const searchInput = document.getElementById('search-input') as HTMLInputElement;
                if (searchInput) searchInput.value = word;
                searchWord(word);
            }
        });
    });
}

