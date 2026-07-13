interface WordbookWordItem {
    word: string;
    type?: string;
    phonetic?: string;
    meanings?: Array<{ part: string; definition: string }>;
    timestamp?: number;
    translation?: string;
    addedTime?: number;
    errorCount?: number;
    correctCount?: number;
}

// Wordbook management: create/rename/delete wordbooks, word list, Vue virtual list, import/export, wordbook selector

import { appState, systemWordbooks, jumpToWord, currentSection, showAlert, showConfirm, showPrompt } from '../global';
import { updateStudyStats } from './stats';
import { getErrorbookItemType } from './errorbook';
import { getItemText } from './favorites';
import { SortBy, FilterType, WordSource, ContentType, PageSection } from '../types/enums';
import { playPronunciation } from '../utils/audio';
import { removeFromFavorites } from './favorites';
import { removeFromErrorbook } from './errorbook';
import { virtualScrollMixin } from '../utils/virtualScroll';
import { cardMixin } from '../utils/cardMixin';
import { showToast } from '../utils/gsap';

let lastRenderSignature = '';

// 系统单词本缓存：key = wordbook id, value = word list
const systemWordbookCache: Record<string, WordbookWordItem[]> = {};

// 系统单词本数量缓存：key = wordbook id, value = count
const systemWordbookCounts: Record<string, number> = {};

// AbortController 用于取消系统单词本加载请求
let systemWordbookAbortController: AbortController | null = null;

// AbortController 用于取消单词本列表加载请求
let wordbookListAbortController: AbortController | null = null;
let systemWordbookListAbortController: AbortController | null = null;

/** 中断正在进行的单词本列表加载请求 */
export function abortLoadWordbooks(): void {
    wordbookListAbortController?.abort();
    systemWordbookListAbortController?.abort();
    wordbookListAbortController = null;
    systemWordbookListAbortController = null;
}

/** 中断单词本页面的选择器和列表渲染（切出单词本页时调用） */
export function abortWordbookRendering(): void {
    systemWordbookAbortController?.abort();
    systemWordbookListAbortController?.abort();
    systemWordbookAbortController = null;
    systemWordbookListAbortController = null;
}

async function validateImportTarget(selectedWordbook: string): Promise<boolean> {
    if (!selectedWordbook) {
        await showAlert('请先选择或创建一个单词本！');
        return false;
    }
    if (selectedWordbook.startsWith('sys_')) {
        await showAlert('系统单词本不可导入！');
        return false;
    }
    if (selectedWordbook === WordSource.Favorites || selectedWordbook === WordSource.Errorbook) {
        await showAlert('该单词本不可导入，请选择其他单词本！');
        return false;
    }
    const ok = await showConfirm(`确定要导入到单词本「${selectedWordbook}」吗？`, '导入确认');
    return ok;
}

export function initWordbookManagement(): void {
    const createWordbookBtn = document.getElementById('create-wordbook') as HTMLButtonElement;
    const deleteWordbookBtn = document.getElementById('delete-wordbook') as HTMLButtonElement;
    const wordbookSelect = document.getElementById('wordbook-select') as HTMLSelectElement;
    const importWordbookBtn = document.getElementById('import-wordbook-btn') as HTMLButtonElement;
    const importWordbookInput = document.getElementById('import-wordbook') as HTMLInputElement;
    const exportWordbookBtn = document.getElementById('export-wordbook-btn') as HTMLButtonElement;

    loadWordbooks();

    createWordbookBtn.addEventListener('click', function() {
        const nameInput = document.getElementById('new-wordbook-name') as HTMLInputElement;
        if (!nameInput) return;
        const name = nameInput.value.trim();
        if (name) {
            createWordbook(name);
        } else {
            void showAlert('请输入单词本名称');
        }
    });

    deleteWordbookBtn.addEventListener('click', async function() {
        const selectedWordbook = wordbookSelect.value;
        if (selectedWordbook && selectedWordbook.startsWith('sys_')) {
            await showAlert('系统单词本不能删除');
            return;
        }
        if (selectedWordbook === WordSource.Favorites || selectedWordbook === WordSource.Errorbook) {
            await showAlert('不能删除收藏或错题本！');
            return;
        }
        if (appState.wordbooks[selectedWordbook]) {
            const ok = await showConfirm(`确定要删除单词本"${selectedWordbook}"吗？该操作不可恢复！`, '删除确认');
            if (ok) {
                deleteWordbook(selectedWordbook);
            }
        }
    });

    importWordbookBtn.addEventListener('click', async function() {
        const selectedWordbook = wordbookSelect.value;
        if (await validateImportTarget(selectedWordbook)) {
            importWordbookInput.click();
        }
    });

    importWordbookInput.addEventListener('change', function(e: Event) {
        const target = e.target as HTMLInputElement;
        const file = target.files?.[0];
        if (file) {
            const selectedWordbook = wordbookSelect.value;
            importWordbook(file, selectedWordbook);
        }
        target.value = '';
    });

    exportWordbookBtn.addEventListener('click', function() {
        const selectedWordbook = wordbookSelect.value;
        if (!selectedWordbook) {
            void showAlert('请先选择一个单词本！');
            return;
        }
        exportWordbook(selectedWordbook);
    });
}

export async function handleImportWordbook(): Promise<void> {
    const wordbookSelect = document.getElementById('wordbook-select') as HTMLSelectElement;
    const selectedWordbook = wordbookSelect.value;
    if (await validateImportTarget(selectedWordbook)) {
        (document.getElementById('import-wordbook') as HTMLInputElement).click();
    }
}

export function handleFileImport(event: Event): void {
    const target = event.target as HTMLInputElement;
    const file = target.files?.[0];
    if (file) {
        const wordbookSelect = document.getElementById('wordbook-select') as HTMLSelectElement;
        const selectedWordbook = wordbookSelect.value;
        importWordbook(file, selectedWordbook);
    }
    target.value = '';
}

export async function handleExportWordbook(): Promise<void> {
    const wordbookSelect = document.getElementById('wordbook-select') as HTMLSelectElement;
    const selectedWordbook = wordbookSelect.value;
    if (!selectedWordbook) {
        await showAlert('请先选择一个单词本！');
        return;
    }
    exportWordbook(selectedWordbook);
}

export async function importWordbook(file: File, wordbookName: string): Promise<void> {
    const loadingToast = showToast('正在后台导入...', 'info');

    try {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('name', wordbookName);

        const response = await fetch('/api/wordbook/import-stream', {
            method: 'POST',
            body: formData
        });

        if (!response.ok) {
            const errData = await response.json().catch(() => null);
            throw new Error(errData?.error?.message || `服务器错误 (${response.status})`);
        }

        if (!response.body) throw new Error('响应体为空');

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let completeEvent: any = null;

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
                if (!line.startsWith('data: ')) continue;
                const jsonStr = line.slice(6).trim();
                if (!jsonStr) continue;

                try {
                    const event = JSON.parse(jsonStr);
                    if (event.type === 'complete') {
                        completeEvent = event;
                    } else if (event.type === 'error') {
                        throw new Error(event.message || '导入失败');
                    }
                } catch {
                    continue;
                }
            }
        }

        if (!completeEvent) throw new Error('导入未完成');

        loadingToast.remove();

        const d = completeEvent.data || {};
        const parts: string[] = [`成功 ${d.success_count || 0} 个`];
        if ((d.duplicated_count || 0) > 0) parts.push(`重复 ${d.duplicated_count} 个`);
        if ((d.failed_count || 0) > 0) parts.push(`失败 ${d.failed_count} 个`);
        showToast(`导入完成：${parts.join('，')}`, 'success');

        await loadWordbooks();
        await updateWordbookSelect();

        const wordbookSelect = document.getElementById('wordbook-select') as HTMLSelectElement;
        if (wordbookSelect) {
            wordbookSelect.value = wordbookName;
            appState.lastSelectedWordbook = wordbookName;
            localStorage.setItem('lastSelectedWordbook', wordbookName);
        }

        await updateSelectedWordbookDisplay();
    } catch (error: unknown) {
        console.error('导入出错:', error);
        loadingToast.remove();
        const message = error instanceof Error ? error.message : '未知错误';
        showToast(`导入出错：${message}`, 'error');
    }
}

export async function exportWordbook(wordbookName: string): Promise<void> {
    const loadingToast = showToast('正在后台导出...', 'info');

    try {
        const exportFormatEl = document.getElementById('export-format') as HTMLSelectElement;
        const exportMeaningEl = document.getElementById('export-meaning') as HTMLInputElement;
        const exportPhoneticEl = document.getElementById('export-phonetic') as HTMLInputElement;
        if (!exportFormatEl || !exportMeaningEl || !exportPhoneticEl) return;

        const response = await fetch('/api/wordbook/export-stream', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name: wordbookName,
                format: exportFormatEl.value,
                export_meaning: exportMeaningEl.checked,
                export_phonetic: exportPhoneticEl.checked,
            }),
        });

        if (!response.ok) {
            const errData = await response.json().catch(() => null);
            throw new Error(errData?.message || `服务器错误 (${response.status})`);
        }

        if (!response.body) throw new Error('响应体为空');
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let doneEvent: any = null;

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed.startsWith('data: ')) continue;

                try {
                    const event = JSON.parse(trimmed.slice(6));
                    if (event.type === 'done') {
                        doneEvent = event;
                    } else if (event.type === 'error') {
                        throw new Error(event.message);
                    }
                } catch {
                    continue;
                }
            }
        }

        if (!doneEvent) throw new Error('导出未完成');

        loadingToast.remove();

        const binary = atob(doneEvent.file);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
        }
        const blob = new Blob([bytes], { type: doneEvent.mimeType });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = doneEvent.filename;
        a.click();
        URL.revokeObjectURL(url);

        showToast(`导出成功！共 ${doneEvent.total || '?'} 个单词`, 'success');
    } catch (error: unknown) {
        console.error('导出出错:', error);
        loadingToast.remove();
        const message = error instanceof Error ? error.message : '未知错误';
        showToast(`导出出错：${message}`, 'error');
    }
}

export async function loadWordbooks(): Promise<void> {
    // 切出页面时旧请求会被 abort，这里新建 controller
    wordbookListAbortController?.abort();
    wordbookListAbortController = new AbortController();
    const signal = wordbookListAbortController.signal;

    try {
        // 从后端API获取单词本列表
        const response = await fetch('/api/wordbook/list', { signal });
        const data = await response.json();

        if (data.success) {
            appState.wordbooks = { ...(data.data && data.data.wordbooks) || {} };
            localStorage.setItem('wordbooks', JSON.stringify(appState.wordbooks));
        }
    } catch (e: unknown) {
        if ((e as Error).name === 'AbortError') {
            return;
        }
        console.error('从后端加载单词本失败，尝试从localStorage加载:', e);
        // 从localStorage加载作为后备
        const savedWordbooks = localStorage.getItem('wordbooks');
        if (savedWordbooks) {
            appState.wordbooks = JSON.parse(savedWordbooks);
        }
    } finally {
        wordbookListAbortController = null;
    }
    // loadWordbooks 只负责加载数据，DOM 更新由各自页面入口处理，
    // 避免在测验页后台渲染单词本页面造成切换卡顿。
}

export async function updateWordbookSelect(): Promise<void> {
    const wordbookSelect = document.getElementById('wordbook-select') as HTMLSelectElement;
    wordbookSelect.innerHTML = '';

    const favoritesOption = document.createElement('option');
    favoritesOption.value = WordSource.Favorites;
    favoritesOption.textContent = '我的收藏';
    wordbookSelect.appendChild(favoritesOption);

    const errorbookOption = document.createElement('option');
    errorbookOption.value = WordSource.Errorbook;
    errorbookOption.textContent = '错题本';
    wordbookSelect.appendChild(errorbookOption);

    // 系统单词本数量已缓存就直接用，不再发请求
    const hasSystemCache = Object.keys(systemWordbookCounts).length > 0;
    if (!hasSystemCache) {
        systemWordbookListAbortController?.abort();
        systemWordbookListAbortController = new AbortController();
        const listSignal = systemWordbookListAbortController.signal;

        try {
            const response = await fetch('/api/system-wordbooks', { signal: listSignal });
            const data = await response.json();
            if (data.success && data.data) {
                data.data.forEach((wb: { id: string; name: string; count: number }) => {
                    systemWordbookCounts[wb.id] = wb.count;
                });
            }
        } catch (e) {
            if ((e as Error).name === 'AbortError') {
                return;
            }
            console.error('加载系统单词本失败:', e);
        } finally {
            systemWordbookListAbortController = null;
        }
    }

    // 用缓存的系统单词本数量填充选项
    for (const wb of systemWordbooks) {
        const count = systemWordbookCounts[wb.id];
        if (count === undefined) continue;
        const option = document.createElement('option');
        option.value = wb.id;
        option.textContent = '系统-' + wb.name + ' (' + count + '词)';
        (option as any).dataset.system = 'true';
        wordbookSelect.appendChild(option);
    }

    // 切出单词本页后没必要继续更新选择器
    if (currentSection !== PageSection.Wordbook) return;

    // 添加自定义单词本（跳过保留名称和系统单词本ID）
    const reservedNames = new Set(['wordlist', 'favorites', 'errorbook']);
    for (const name in appState.wordbooks) {
        if (reservedNames.has(name) || name.startsWith('sys_')) continue;
        const option = document.createElement('option');
        option.value = name;
        const wordCount = Array.isArray(appState.wordbooks[name]) ? appState.wordbooks[name].length : 0;
        option.textContent = name + ' (' + wordCount + '词)';
        wordbookSelect.appendChild(option);
    }

    // 设置上次选择的单词本，如果上次选择的不在选项中则默认选"我的收藏"
    const targetValue = appState.lastSelectedWordbook &&
        wordbookSelect.querySelector(`option[value="${appState.lastSelectedWordbook}"]`)
        ? appState.lastSelectedWordbook : WordSource.Favorites;
    wordbookSelect.value = targetValue;
    appState.lastSelectedWordbook = targetValue;
    localStorage.setItem('lastSelectedWordbook', targetValue);

    // 每次重建选择器后重新注册 change 监听（innerHTML 会清空旧事件）
    wordbookSelect.addEventListener('change', function onWordbookChange() {
        const val = wordbookSelect.value;
        appState.lastSelectedWordbook = val;
        localStorage.setItem('lastSelectedWordbook', val);
        // 切换单词本时重置筛选类型为"全部"
        setWordbookFilter(FilterType.All);
    });
}

// 更新所有单词本选择器（查询页面、句子添加页面、测验页面）
export async function updateAllWordbookSelectors(): Promise<void> {
    await updateWordbookSelect();
    await updateWordSourceSelect();
    refreshDictionaryInlineSelectors();
}

function refreshDictionaryInlineSelectors(): void {
    const buildOptions = (selectedVal?: string | null): string => {
        let html = '<option value="" disabled>选择单词本</option>';
        for (const name in appState.wordbooks) {
            if (name.startsWith('sys_')) continue;
            if (name === 'wordlist' || name === 'favorites' || name === 'errorbook') continue;
            const words = appState.wordbooks[name];
            const count = Array.isArray(words) ? words.length : 0;
            html += `<option value="${name}">${name} (${count}词)</option>`;
        }
        return html;
    };

    // 单词查询结果里的下拉框
    const wordSel = document.getElementById('wordbook-selector') as HTMLSelectElement | null;
    if (wordSel) {
        const prev = wordSel.value;
        wordSel.innerHTML = buildOptions();
        if (prev && wordSel.querySelector(`option[value="${prev}"]`)) {
            wordSel.value = prev;
        }
    }

    // 句子翻译结果里的下拉框
    const sentSel = document.getElementById('sentence-wordbook-select-inline') as HTMLSelectElement | null;
    if (sentSel) {
        const prev = sentSel.value || localStorage.getItem('lastSentenceWordbook');
        sentSel.innerHTML = buildOptions();
        if (prev && sentSel.querySelector(`option[value="${prev}"]`)) {
            sentSel.value = prev;
        }
        // 句子按钮状态同步
        const sentWbBtn = document.getElementById('add-sentence-to-wordbook');
        const sentFavBtn = document.getElementById('add-sentence-to-favorites');
        const sentence = (appState as any).currentSentence?.text;
        if (sentence && sentWbBtn && sentSel.value) {
            const inWb = (appState.wordbooks[sentSel.value] || []).some((it: any) =>
                (typeof it === 'string' ? it : it.word) === sentence
            );
            sentWbBtn.classList.toggle('active', inWb);
            sentWbBtn.textContent = inWb ? '已在单词本' : '加入单词本';
        }
        if (sentence && sentFavBtn) {
            const inFav = (appState.favorites || []).some((it: any) => {
                const t = typeof it === 'string' ? it : (it.word || it.text);
                return t === sentence;
            });
            sentFavBtn.classList.toggle('active', inFav);
            sentFavBtn.textContent = inFav ? '已收藏' : '加入收藏';
        }
    }
}

function getPracticedWords(): Set<string> {
    const practiced = new Set<string>();
    try {
        const answered = JSON.parse(localStorage.getItem('quizAnsweredWords') || '[]') as string[];
        answered.forEach(w => practiced.add(w));
    } catch {}
    try {
        const history = JSON.parse(localStorage.getItem('learningHistory') || '{}') as Record<string, any>;
        Object.keys(history).forEach(w => practiced.add(w));
    } catch {}
    return practiced;
}

export function getSourceProgress(value: string): { total: number; practiced: number; remaining: number } {
    const words = getSourceWordList(value);
    const practicedSet = getPracticedWords();
    const practiced = words.filter(w => practicedSet.has(w)).length;
    return {
        total: words.length,
        practiced,
        remaining: Math.max(0, words.length - practiced)
    };
}

export function getSourceWordList(value: string): string[] {
    if (value === WordSource.Favorites) {
        return appState.favorites.map((w: any) => typeof w === 'string' ? w : w.word);
    }
    if (value === WordSource.Errorbook) {
        return Object.keys(appState.errorbook);
    }
    if (value.startsWith('wordbook:')) {
        const name = value.replace('wordbook:', '');
        const words = appState.wordbooks[name] || [];
        return words.map((w: any) => typeof w === 'string' ? w : w.word);
    }
    if (value.startsWith('system:')) {
        const tag = value.replace('system:', '');
        try {
            const cache = JSON.parse(localStorage.getItem('systemWordbookWordsCache') || '{}') as Record<string, string[]>;
            return cache[tag] || [];
        } catch {
            return [];
        }
    }
    return [];
}

function formatSourceStats(total: number, practiced: number): string {
    const unpracticed = Math.max(0, total - practiced);
    return `（共${total}词 已练习：${practiced}词 未练习：${unpracticed}词）`;
}

export async function updateWordSourceSelect(): Promise<void> {
    const wordSourceSelect = document.getElementById('word-source') as HTMLSelectElement;
    if (!wordSourceSelect) return;

    // 确保系统单词本数量已加载
    const hasSystemCache = Object.keys(systemWordbookCounts).length > 0;
    if (!hasSystemCache) {
        systemWordbookListAbortController?.abort();
        systemWordbookListAbortController = new AbortController();
        const listSignal = systemWordbookListAbortController.signal;
        try {
            const response = await fetch('/api/system-wordbooks', { signal: listSignal });
            const data = await response.json();
            if (data.success && data.data) {
                data.data.forEach((wb: { id: string; name: string; count: number }) => {
                    systemWordbookCounts[wb.id] = wb.count;
                });
            }
        } catch (e) {
            if ((e as Error).name === 'AbortError') return;
            console.error('加载系统单词本失败:', e);
        } finally {
            systemWordbookListAbortController = null;
        }
    }

    const currentValue = wordSourceSelect.value;
    wordSourceSelect.innerHTML = '';

    const practiced = getPracticedWords();

    function createOption(value: string, name: string, total: number, practicedCount: number): HTMLOptionElement {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = name + ' ' + formatSourceStats(total, practicedCount);
        option.dataset.name = name;
        return option;
    }

    Object.keys(appState.wordbooks).forEach(name => {
        if (name.startsWith('sys_')) return;
        const value = `wordbook:${name}`;
        const words = getSourceWordList(value);
        const practicedCount = words.filter(w => practiced.has(w)).length;
        wordSourceSelect.appendChild(createOption(value, name, words.length, practicedCount));
    });

    let favWords = getSourceWordList(WordSource.Favorites);
    wordSourceSelect.appendChild(createOption(WordSource.Favorites, '我的收藏', favWords.length, favWords.filter(w => practiced.has(w)).length));

    let errWords = getSourceWordList(WordSource.Errorbook);
    wordSourceSelect.appendChild(createOption(WordSource.Errorbook, '错题本', errWords.length, errWords.filter(w => practiced.has(w)).length));

    systemWordbooks.forEach(wb => {
        const value = 'system:' + wb.tag;
        const total = systemWordbookCounts[wb.id] ?? 0;
        const sysWords = getSourceWordList(value);
        const practicedCount = sysWords.filter(w => practiced.has(w)).length;
        wordSourceSelect.appendChild(createOption(value, '系统-' + wb.name, total, practicedCount));
    });

    if (wordSourceSelect.querySelector(`option[value="${currentValue}"]`)) {
        wordSourceSelect.value = currentValue;
    }

    setupWordSourceDisplay(wordSourceSelect);
}

function setupWordSourceDisplay(select: HTMLSelectElement): void {
    // 把 select 包在相对定位容器里，上面盖一层只显示纯名称的 div
    let wrapper = select.parentElement as HTMLElement | null;
    let display = wrapper?.querySelector('.word-source-display') as HTMLElement | null;

    if (!wrapper || !wrapper.classList.contains('word-source-wrapper')) {
        wrapper = document.createElement('div');
        wrapper.className = 'word-source-wrapper';
        select.parentNode?.insertBefore(wrapper, select);
        wrapper.appendChild(select);
    }

    if (!display) {
        display = document.createElement('div');
        display.className = 'word-source-display';
        wrapper.appendChild(display);
    }

    function updateDisplay(): void {
        const selected = select.options[select.selectedIndex];
        display!.textContent = selected?.dataset.name || selected?.textContent || '';
    }

    if (!select.dataset.displayBound) {
        select.addEventListener('change', updateDisplay);
        select.dataset.displayBound = '1';
    }

    updateDisplay();
}

export async function createWordbook(name: string): Promise<void> {
    try {
        const response = await fetch('/api/wordbook/create', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ name: name })
        });

        const data = await response.json();

        if (data.success) {
            appState.wordbooks = { ...(data.data && data.data.wordbooks) || {} };
            localStorage.setItem('wordbooks', JSON.stringify(appState.wordbooks));
            await updateAllWordbookSelectors();
            showToast('单词本创建成功', 'success');
            const nameInput = document.getElementById('new-wordbook-name') as HTMLInputElement;
            if (nameInput) nameInput.value = '';
        } else {
            showToast((data.error && data.error.message) || '创建单词本失败', 'error');
        }
    } catch (e: unknown) {
        console.error('创建单词本失败:', e);
        showToast('创建单词本失败', 'error');
    }
}

export async function deleteWordbook(name: string): Promise<void> {
    try {
        const response = await fetch('/api/wordbook/delete', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ name: name })
        });

        const data = await response.json();

        if (data.success) {
            appState.wordbooks = { ...(data.data && data.data.wordbooks) || {} };
            localStorage.setItem('wordbooks', JSON.stringify(appState.wordbooks));
            // 如果删除的是当前选择的单词本，清空选择
            if (appState.lastSelectedWordbook === name) {
                appState.lastSelectedWordbook = '';
                localStorage.setItem('lastSelectedWordbook', appState.lastSelectedWordbook);
            }
            // 先完成 UI 刷新再 toast，避免提示覆盖后续交互
            await updateAllWordbookSelectors();
            await updateSelectedWordbookDisplay();
            showToast('单词本删除成功', 'success');
        } else {
            showToast((data.error && data.error.message) || '删除单词本失败', 'error');
        }
    } catch (e: unknown) {
        console.error('删除单词本失败:', e);
        showToast('删除单词本失败', 'error');
    }
}

export async function renameWordbook(oldName: string): Promise<void> {
    const newName = await showPrompt('请输入新名称：', oldName, '重命名单词本');
    if (!newName || newName.trim() === '' || newName.trim() === oldName) {
        return;
    }

    try {
        const response = await fetch('/api/wordbook/rename', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ oldName: oldName, newName: newName.trim() })
        });

        const data = await response.json();

        if (data.success) {
            appState.wordbooks = { ...(data.data && data.data.wordbooks) || {} };
            localStorage.setItem('wordbooks', JSON.stringify(appState.wordbooks));
            if (appState.lastSelectedWordbook === oldName) {
                appState.lastSelectedWordbook = newName.trim();
                localStorage.setItem('lastSelectedWordbook', appState.lastSelectedWordbook);
            }
            await updateAllWordbookSelectors();
            await updateSelectedWordbookDisplay();
            showToast('单词本重命名成功', 'success');
        } else {
            showToast((data.error && data.error.message) || '重命名失败', 'error');
        }
    } catch (e: unknown) {
        console.error('重命名单词本失败:', e);
        showToast('重命名单词本失败', 'error');
    }
}

export function setWordbookFilter(type: string): void {
    appState.wordbookFilter = type as FilterType;
    localStorage.setItem('wordbookFilter', type);

    document.querySelectorAll('#wordbook-page .filter-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    const btnMap: Record<string, string> = {
        'all': 'wordbook-filter-all',
        'word': 'wordbook-filter-word',
        'phrase': 'wordbook-filter-phrase',
        'sentence': 'wordbook-filter-sentence'
    };
    const targetBtn = document.getElementById(btnMap[type]);
    if (targetBtn) targetBtn.classList.add('active');

    updateSelectedWordbookDisplay();
}

export function setWordbookSort(sortBy: string): void {
    appState.wordbookSortBy = sortBy as SortBy;
    localStorage.setItem('wordbookSortBy', sortBy);

    document.querySelectorAll('#wordbook-page .sort-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    const btnMap: Record<string, string> = {
        'alphabetical': 'wordbook-sort-alpha',
        'time': 'wordbook-sort-time'
    };
    const targetBtn = document.getElementById(btnMap[sortBy]);
    if (targetBtn) targetBtn.classList.add('active');

    updateSelectedWordbookDisplay();
}

export function getFilterLabel(filterType: FilterType): string {
    const map: Record<string, string> = {
        [FilterType.All]: '全部',
        [FilterType.Word]: '单词',
        [FilterType.Phrase]: '词组',
        [FilterType.Sentence]: '句子'
    };
    return map[filterType] || '全部';
}

export function getWordbookItemType(item: any): string {
    const word = typeof item === 'string' ? item : (item.word || '');
    const words = word.trim().split(/\s+/);
    if (words.length <= 1) return ContentType.Word;
    if (words.length > 5 || /[.!?;]/.test(word)) return ContentType.Sentence;
    return ContentType.Phrase;
}

// 按类型规范化：单词/短语首字母小写，词组强制全小写，句子首字母大写
export function normalizeCaseByType(text: string): string {
    if (!text || text.length === 0) return text;
    const type = getWordbookItemType(text);
    if (type === ContentType.Sentence) {
        return text.charAt(0).toUpperCase() + text.slice(1);
    }
    if (type === ContentType.Phrase) {
        return text.toLowerCase();
    }
    return text.charAt(0).toLowerCase() + text.slice(1);
}


export function removeFromWordlist(word: string): void {
    // 在所有自定义单词本中查找并移除
    let removed = false;
    for (const name in appState.wordbooks) {
        const before = appState.wordbooks[name].length;
        appState.wordbooks[name] = appState.wordbooks[name].filter(item => {
            const itemWord = typeof item === 'string' ? item : item.word;
            return itemWord !== word;
        });
        if (appState.wordbooks[name].length < before) removed = true;
    }
    if (removed) localStorage.setItem('wordbooks', JSON.stringify(appState.wordbooks));

    updateSelectedWordbookDisplay();

    // 如果当前显示的是该单词，更新单词本按钮状态
    const currentWord = document.getElementById('word')?.textContent;
    if (currentWord === word) {
        const addToWordlistBtn = document.getElementById('add-to-wordlist');
        if (addToWordlistBtn) {
            addToWordlistBtn.classList.remove('active');
            addToWordlistBtn.textContent = '加入单词本';
        }
    }
}

export async function removeFromCustomWordbook(wordbookName: string, word: string): Promise<void> {
    try {
        const response = await fetch('/api/wordbook/remove', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                wordbook: wordbookName,
                word: word
            })
        });

        const data = await response.json();

        if (data.success) {
            appState.wordbooks = { ...(data.data && data.data.wordbooks) || {} };
            localStorage.setItem('wordbooks', JSON.stringify(appState.wordbooks));
            updateSelectedWordbookDisplay();
        }
    } catch (e: unknown) {
        console.error('从单词本移除单词失败:', e);
    }
}

// 拖拽排序后持久化到后端 wordbooks.json
async function persistWordbookOrder(wordbookName: string, sortedList: WordbookWordItem[]): Promise<void> {
    if (!wordbookName || wordbookName.startsWith('sys_') ||
        wordbookName === WordSource.Favorites || wordbookName === WordSource.Errorbook) {
        return;
    }
    const order = sortedList.map(item => item.word);
    appState.wordbooks[wordbookName] = order;
    try {
        await fetch('/api/wordbook/reorder', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: wordbookName, order })
        });
    } catch (e: unknown) { console.error('单词本排序持久化失败:', e); }
}

export async function updateSelectedWordbookDisplay(): Promise<void> {
    // 取消上一次系统单词本加载请求（避免频繁切换时堆积请求）
    if (systemWordbookAbortController) {
        systemWordbookAbortController.abort();
    }
    systemWordbookAbortController = new AbortController();
    const abortSignal = systemWordbookAbortController.signal;

    // 已经切出单词本页，直接放弃后续渲染
    if (currentSection !== PageSection.Wordbook) return;

    const wordbookSelect = document.getElementById('wordbook-select') as HTMLSelectElement;
    // 以 appState.lastSelectedWordbook 为唯一数据源，避免 DOM 与状态不同步
    let selectedWordbook = appState.lastSelectedWordbook || WordSource.Favorites;

    // 如果下拉框中的选项不包含当前选中的 wordbook，则回退到 "我的收藏"
    if (wordbookSelect && !wordbookSelect.querySelector(`option[value="${selectedWordbook}"]`)) {
        selectedWordbook = WordSource.Favorites;
        appState.lastSelectedWordbook = WordSource.Favorites;
        localStorage.setItem('lastSelectedWordbook', WordSource.Favorites);
    }

    // 同步下拉框选中状态
    if (wordbookSelect && wordbookSelect.querySelector(`option[value="${selectedWordbook}"]`)) {
        wordbookSelect.value = selectedWordbook;
    }

    // 同步重命名/删除/导入按钮状态
    const isSystem = selectedWordbook.startsWith('sys_');
    const isDefault = selectedWordbook === WordSource.Favorites || selectedWordbook === WordSource.Errorbook;
    const renameBtn = document.getElementById('rename-wordbook') as HTMLButtonElement;
    const deleteBtn = document.getElementById('delete-wordbook') as HTMLButtonElement;
    const importBtn = document.getElementById('import-wordbook-btn') as HTMLButtonElement;

    if (renameBtn) {
        renameBtn.disabled = isSystem || isDefault;
        renameBtn.style.opacity = (isSystem || isDefault) ? '0.5' : '1';
    }
    if (deleteBtn) {
        deleteBtn.disabled = isSystem || isDefault;
        deleteBtn.style.opacity = (isSystem || isDefault) ? '0.5' : '1';
    }
    if (importBtn) {
        importBtn.disabled = isSystem;
        importBtn.style.opacity = isSystem ? '0.5' : '1';
    }

    const selectedWordbookTitle = document.getElementById('selected-wordbook-title');
    const selectedWordbookEmpty = document.getElementById('selected-wordbook-empty');
    const selectedWordbookContent = document.getElementById('selected-wordbook-content');

    if (!selectedWordbookTitle || !selectedWordbookEmpty || !selectedWordbookContent) return;

    selectedWordbookContent.classList.add('wordbook-content-visible');

    let title = selectedWordbook === WordSource.Favorites ? '我的收藏' :
                selectedWordbook === WordSource.Errorbook ? '错题本' : selectedWordbook;

    if (selectedWordbook === WordSource.Favorites) {
        title = `我的收藏 (${appState.favorites.length}词)`;
    } else if (selectedWordbook === WordSource.Errorbook) {
        title = `错题本 (${Object.keys(appState.errorbook).length}词)`;
    } else if (appState.wordbooks[selectedWordbook]) {
        title = `${selectedWordbook} (${appState.wordbooks[selectedWordbook].length}词)`;
    } else if (selectedWordbook && selectedWordbook.startsWith('sys_')) {
        const sysWb = systemWordbooks.find(wb => wb.id === selectedWordbook);
        const sysCount = systemWordbookCounts[selectedWordbook];
        if (sysWb) {
            title = sysCount !== undefined
                ? `系统-${sysWb.name} (${sysCount}词)`
                : `系统-${sysWb.name}`;
        }
    }

    // 标题先写基础版本，等筛选完成后再追加“筛选后数量”
    selectedWordbookTitle.textContent = title;

    const wordbookSearch = document.getElementById('wordbook-search') as HTMLInputElement;
    let searchKeyword = wordbookSearch ? wordbookSearch.value.trim() : '';

    // 计算当前数据源总条数，用于标题和判断是否需要重新渲染
    let sourceCount = 0;
    if (selectedWordbook === WordSource.Favorites) {
        sourceCount = appState.favorites.length;
    } else if (selectedWordbook === WordSource.Errorbook) {
        sourceCount = Object.keys(appState.errorbook).length;
    } else if (appState.wordbooks[selectedWordbook]) {
        sourceCount = appState.wordbooks[selectedWordbook].length;
    } else if (selectedWordbook.startsWith('sys_')) {
        sourceCount = systemWordbookCache[selectedWordbook]?.length ?? systemWordbookCounts[selectedWordbook] ?? -1;
    }

    const renderSignature = `${selectedWordbook}|${appState.wordbookFilter}|${appState.wordbookSortBy}|${searchKeyword}|${sourceCount}`;
    if (renderSignature === lastRenderSignature && appState.wordbookVueInstance) return;
    lastRenderSignature = renderSignature;

    if (currentSection !== PageSection.Wordbook) return;

    initWordbookVue();

    let words: WordbookWordItem[] = [];
    if (selectedWordbook === WordSource.Favorites) {
        // 转换为Vue需要的格式
        words = appState.favorites.map((item: unknown) => {
            const text = (typeof item === 'string') ? item : getItemText(item);
            const type = (typeof item === 'string') ? getErrorbookItemType(text) : getErrorbookItemType(item);

            return {
                word: text,
                type: type,
                timestamp: (typeof item === 'object' && (item as any).timestamp) ? (item as any).timestamp : 0,
                translation: (typeof item === 'object' && (item as any).translation) ? (item as any).translation : '',
                meanings: (typeof item === 'object' && (item as any).meanings) ? (item as any).meanings : [],
                phonetic: (typeof item === 'object' && (item as any).phonetic) ? (item as any).phonetic : ''
            };
        });
    } else if (selectedWordbook === WordSource.Errorbook) {
        const errorWords = Object.keys(appState.errorbook);
        words = errorWords.map(word => {
            const data: any = appState.errorbook[word] || {};
            return {
                word: word,
                type: getErrorbookItemType(word),
                timestamp: data.addedTime || 0,
                errorCount: data.errorCount || 0,
                correctCount: data.correctCount || 0,
                phonetic: '',
                meanings: [{ part: '', definition: '' }]
            };
        });
    } else if (appState.wordbooks[selectedWordbook]) {
        words = appState.wordbooks[selectedWordbook].map(wordStr => {
            const wordObj = (typeof wordStr === 'string')
                ? { word: wordStr, phonetic: '', meanings: [{ part: '', definition: '' }] }
                : wordStr;
            // 确保每个对象都有type属性
            if (!wordObj.type) {
                wordObj.type = getErrorbookItemType(wordObj);
            }
            return wordObj;
        });
    } else if (selectedWordbook && selectedWordbook.startsWith('sys_')) {
        const sysWb = systemWordbooks.find(wb => wb.id === selectedWordbook);
        if (sysWb) {
            // 命中缓存，直接返回
            if (systemWordbookCache[selectedWordbook]) {
                words = systemWordbookCache[selectedWordbook];
            } else {
                // 显示加载提示 + 进度条（搜索框下方的专用容器）
                const loadingContainer = document.getElementById('sys-wordbook-loading');
                if (loadingContainer) {
                    loadingContainer.classList.add('loading-visible');
                    loadingContainer.classList.remove('loading-hidden');
                }
                const progressBar = document.getElementById('sys-wb-progress-bar');
                const loadingText = document.getElementById('sys-wb-loading-text');
                if (progressBar) {
                    progressBar.style.width = '0%';
                    progressBar.textContent = '0%';
                }
                if (loadingText) {
                    loadingText.textContent = '正在加载单词列表...';
                }

                if (currentSection !== PageSection.Wordbook) return;
                appState.wordbookVueInstance.setWordList([], selectedWordbook, appState.errorbook);

                // 从SQLite分页加载系统单词本所有单词（每次200条，边加载边渲染）
                try {
                    const PAGE_SIZE = 200;
                    let allWords: { word: string; phonetic?: string; translation?: string }[] = [];
                    let offset = 0;
                    let hasMore = true;
                    let lastTotal = 0;

                    // 进度条更新节流（避免频繁 DOM 操作）
                    let lastUpdateTime = 0;
                    const UPDATE_THROTTLE = 50;
                    const updateProgress = (loaded: number, total: number) => {
                        const now = Date.now();
                        if (now - lastUpdateTime < UPDATE_THROTTLE) return;
                        lastUpdateTime = now;
                        const percent = Math.min(Math.floor((loaded / total) * 100), 100);
                        const progressBar = document.getElementById('sys-wb-progress-bar');
                        const loadingText = document.getElementById('sys-wb-loading-text');
                        if (progressBar) {
                            progressBar.style.width = percent + '%';
                            progressBar.textContent = percent + '%';
                        }
                        if (loadingText) {
                            loadingText.textContent = `正在加载单词列表... (${loaded}/${total})`;
                        }
                    };

                    const renderBatch = async () => {
                        if (currentSection !== PageSection.Wordbook) return;
                        words = allWords.map((w: { word: string; phonetic?: string; translation?: string }) => ({
                            word: w.word,
                            phonetic: w.phonetic || '',
                            meanings: [{ part: '', definition: w.translation || '' }],
                            type: getErrorbookItemType(w.word)
                        }));
                        // keepScroll=true 保留滚动位置
                        appState.wordbookVueInstance.setWordList(words, selectedWordbook, appState.errorbook, true);
                        // 给Vue渲染留时间
                        await new Promise(r => setTimeout(r, 0));
                    };

                    while (hasMore) {
                        if (currentSection !== PageSection.Wordbook) break;
                        const response = await fetch(
                            `/api/system-wordbook/words?tag=${sysWb.tag}&limit=${PAGE_SIZE}&offset=${offset}`,
                            { signal: abortSignal }
                        );
                        const data = await response.json();
                        if (data.success && data.data && data.data.words && data.data.words.length > 0) {
                            allWords = allWords.concat(data.data.words);
                            offset += PAGE_SIZE;
                            lastTotal = data.data.total || allWords.length;
                            updateProgress(allWords.length, lastTotal);
                            // 立刻渲染已加载的单词（保留滚动位置）
                            await renderBatch();
                            hasMore = data.data.hasMore || false;
                        } else {
                            hasMore = false;
                        }
                    }

                    if (currentSection !== PageSection.Wordbook) return;

                    // 最终确保进度 100%
                    if (allWords.length > 0) {
                        updateProgress(allWords.length, lastTotal);
                        if (loadingText) {
                            loadingText.textContent = `加载完成！共 ${allWords.length} 个单词`;
                        }
                        // 延迟隐藏进度条
                        setTimeout(() => {
                            const loadingContainer = document.getElementById('sys-wordbook-loading');
                            if (loadingContainer) {
                                loadingContainer.classList.add('loading-hidden');
                                loadingContainer.classList.remove('loading-visible');
                            }
                        }, 1500);
                    } else {
                        // 没有数据，隐藏进度条
                        const loadingContainer = document.getElementById('sys-wordbook-loading');
                        if (loadingContainer) {
                            loadingContainer.classList.add('loading-hidden');
                                loadingContainer.classList.remove('loading-visible');
                        }
                    }

                    // 存入缓存（words 已由 renderBatch 设置）
                    systemWordbookCache[selectedWordbook] = words;
                    systemWordbookCounts[selectedWordbook] = words.length;
                } catch (e: unknown) {
                    // 用户切换页面导致的取消，不算错误
                    const isAbort = e instanceof DOMException && e.name === 'AbortError';
                    if (!isAbort) {
                        console.error('加载系统单词本单词失败:', e);
                    }
                    // 错误时隐藏进度条
                    const loadingContainer = document.getElementById('sys-wordbook-loading');
                    if (loadingContainer) {
                        loadingContainer.classList.add('loading-hidden');
                                loadingContainer.classList.remove('loading-visible');
                    }
                }
                // 系统单词本不合并自定义单词，只显示SQLite中的数据
            }
        }
    }

    // 类型筛选 - 直接使用已有的type属性
    if (appState.wordbookFilter !== FilterType.All) {
        words = words.filter(item => {
            // 如果item已有type，直接使用；否则计算
            const itemType = item.type || getWordbookItemType(item);
            return itemType === appState.wordbookFilter;
        });
    }

    if (searchKeyword) {
        const key = searchKeyword.toLowerCase();
        const startsWithWords: WordbookWordItem[] = [], containsWords: WordbookWordItem[] = [];
        words.forEach(item => {
            const wordLower = item.word.toLowerCase();
            if (wordLower.startsWith(key)) startsWithWords.push(item);
            else if (wordLower.includes(key)) containsWords.push(item);
        });
        startsWithWords.sort((a, b) => a.word.localeCompare(b.word, 'en'));
        containsWords.sort((a, b) => a.word.localeCompare(b.word, 'en'));
        words = [...startsWithWords, ...containsWords];
    } else {
        if (appState.wordbookSortBy === SortBy.Alphabetical) {
            words.sort((a, b) => a.word.localeCompare(b.word, 'en'));
        } else if (appState.wordbookSortBy === 'time') {
            // 按添加时间排序（最新的在前）
            words.sort((a, b) => {
                const timeA = a.timestamp || a.addedTime || 0;
                const timeB = b.timestamp || b.addedTime || 0;
                return timeB - timeA;
            });
        }
    }

    // 标题追加当前筛选结果数量，例如：四级（词组 2/14）
    const filterLabel = getFilterLabel(appState.wordbookFilter);
    const totalCount = sourceCount >= 0 ? sourceCount : words.length;
    if (appState.wordbookFilter !== FilterType.All) {
        selectedWordbookTitle.textContent = `${title.replace(/\s*\(\d+词\)$/, '')}（${filterLabel} ${words.length}/${totalCount}）`;
    }

    if (words.length === 0) {
        selectedWordbookEmpty.classList.add('empty-visible');
        selectedWordbookEmpty.classList.remove('empty-hidden');
        selectedWordbookEmpty.textContent = appState.wordbookFilter !== FilterType.All
            ? `当前筛选下没有「${filterLabel}」内容，可切换“全部”查看`
            : '暂无单词';
        appState.wordbookVueInstance.setWordList([], selectedWordbook, appState.errorbook);
    } else {
        selectedWordbookEmpty.classList.add('empty-hidden');
        selectedWordbookEmpty.classList.remove('empty-visible');
        appState.wordbookVueInstance.setWordList(words, selectedWordbook, appState.errorbook);
    }
}

export function initWordbookVue(): void {
    if (appState.wordbookVueInstance) return;

    const { createApp, ref, reactive, computed, nextTick, watch } = (window as any).Vue;

    const app = createApp({
        template: '#wordbook-vue-template',
        mixins: [virtualScrollMixin, cardMixin],
        data() {
            return {
                wordList: [] as WordbookWordItem[],
                itemHeights: {} as Record<string, number>,
                isSystemWordbook: false,
                selectedWordbook: '',
                _errorbook: {} as Record<string, unknown>,
                allExamples: [] as unknown[],
                dragIndex: -1,
                overIndex: -1,
            };
        },
        methods: {
            errorInfo(word: string) {
                if (this.selectedWordbook === WordSource.Errorbook && this._errorbook && this._errorbook[word]) {
                    const d = this._errorbook[word];
                    return `错误次数: ${d.errorCount}, 正确次数: ${d.correctCount}`;
                }
                return '';
            },
            playPron(type: string, word: string) {
                playPronunciation(type, word);
            },
            removeWord(word: string) {
                this._animateWordRemoval(word, () => {
                    if (this.selectedWordbook === WordSource.Favorites) {
                        removeFromFavorites(word);
                    } else if (this.selectedWordbook === WordSource.Errorbook) {
                        removeFromErrorbook(word);
                    } else if (appState.wordbooks[this.selectedWordbook]) {
                        if (typeof removeFromCustomWordbook === 'function') removeFromCustomWordbook(this.selectedWordbook, word);
                    }
                    if (!appState.wordbooks[this.selectedWordbook]) {
                        this.wordList = this.wordList.filter(item => item.word !== word);
                    }
                });
            },
            jumpToWord(word: string) {
                jumpToWord(word);
            },
            setWordList(words: WordbookWordItem[], selectedWordbook?: string, errorbookData?: Record<string, unknown>, keepScroll?: boolean) {
                const prevWordbook = this.selectedWordbook;
                const processed = words.map(item => {
                    const type = item.type || getWordbookItemType(item);
                    const displayWord = normalizeCaseByType(item.word);
                    return { ...item, type, displayWord };
                });
                const wordSet = new Set(processed.map(w => w.word));
                this.wordList = processed;
                this.selectedWordbook = selectedWordbook || '';
                this._errorbook = errorbookData || {};
                this.isSystemWordbook = !!(selectedWordbook && selectedWordbook.startsWith('sys_'));

                if (prevWordbook !== this.selectedWordbook) {
                    this.expandedMap = {};
                    this.flippedMap = {};
                    this.definitions = {};
                    this.examples = {};
                    this.loadingDefinitions = {};
                    this.loadingExamples = {};
                    this.itemHeights = {};
                    this.cachedHeights = {};
                } else {
                    // 同单词本内保留展开/翻转状态和已加载释义，清理已不在列表中的单词缓存
                    Object.keys(this.expandedMap).forEach(k => { if (!wordSet.has(k)) delete this.expandedMap[k]; });
                    Object.keys(this.flippedMap).forEach(k => { if (!wordSet.has(k)) delete this.flippedMap[k]; });
                    Object.keys(this.definitions).forEach(k => { if (!wordSet.has(k)) delete this.definitions[k]; });
                    Object.keys(this.examples).forEach(k => { if (!wordSet.has(k)) delete this.examples[k]; });
                    Object.keys(this.loadingDefinitions).forEach(k => { if (!wordSet.has(k)) delete this.loadingDefinitions[k]; });
                    Object.keys(this.loadingExamples).forEach(k => { if (!wordSet.has(k)) delete this.loadingExamples[k]; });
                    Object.keys(this.itemHeights).forEach(k => { if (!wordSet.has(k)) delete this.itemHeights[k]; });
                    Object.keys(this.cachedHeights).forEach(k => { if (!wordSet.has(k)) delete this.cachedHeights[k]; });
                }

                if (!keepScroll) {
                    this.clearCache();
                    this.scrollTop = 0;
                    this._pendingScrollTop = 0;
                }

                // 切页/筛选排序返回后恢复翻转卡片的释义与高度
                if (prevWordbook === this.selectedWordbook) {
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
                } else {
                    // 新单词本首次渲染后统一测量可见卡片高度
                    this.$nextTick(() => {
                        setTimeout(() => this.measureVisibleHeights(), 50);
                    });
                }
            },
            onDragStart(e: DragEvent, index: number) {
                this.dragIndex = index;
                (e.target as HTMLElement).classList.add('dragging');
            },
            onDragOver(e: DragEvent, index: number) {
                this.overIndex = index;
            },
            onDragEnd() {
                const root = this.$el as HTMLElement | null;
                if (root) {
                    root.querySelectorAll('[data-word].dragging').forEach(el => { el.classList.remove('dragging'); });
                }
                if (this.dragIndex >= 0 && this.overIndex >= 0 && this.dragIndex !== this.overIndex) {
                    const item = this.wordList.splice(this.dragIndex, 1)[0];
                    this.wordList.splice(this.overIndex, 0, item);
                    persistWordbookOrder(this.selectedWordbook, this.wordList);
                }
                this.dragIndex = -1;
                this.overIndex = -1;
            },
        },
    });

    appState.wordbookVueInstance = app.mount('#wordbook-vue-app');
}