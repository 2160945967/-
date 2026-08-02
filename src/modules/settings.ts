// 设置页面：配置读写、缓存清理、弹窗

import { appState, hasChinese, openModal, closeModal, showAlert, showConfirm, switchPage } from '../global';
import { showToast } from '../utils/gsap';
import { PronunciationType, QuizMode, QuizOrder, WordSource } from '../types/enums';
import { playPronunciation } from '../utils/audio';
import { updateTomorrowWords, updateStudyStats } from './stats';
import { updateWordbookSelect, updateSelectedWordbookDisplay } from './wordbook';
import { updateFavoritesDisplay } from './favorites';
import { updateErrorbookDisplay } from './errorbook';
import { showAnswer } from './quiz';

let _settingsKeyupHandler: ((e: KeyboardEvent) => void) | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

function quizAddToFavorites(): void {
    const word = appState.currentQuizWord?.word;
    if (!word) return;
    const isInFavorites = appState.favorites.some((item: any) => item.word === word);
    if (isInFavorites) {
        void showAlert('该单词已在收藏中');
        return;
    }
    appState.favorites.push({ word, phonetic: appState.currentQuizWord.phonetic || '', meanings: appState.currentQuizWord.meanings || [] });
    updateFavoritesDisplay();
    updateStudyStats();
    void showAlert('已添加到收藏');
}

export function initSettings(): void {
    const saveSettingsBtn = document.getElementById('save-settings');
    const clearCacheBtn = document.getElementById('clear-cache');

    loadSettings();

    initSortableContainers();

    const multiPartSlider = document.getElementById('quiz-multi-part-probability') as HTMLInputElement;
    const singlePartSlider = document.getElementById('quiz-single-part-probability') as HTMLInputElement;
    const multiPartValue = document.getElementById('quiz-multi-part-value');
    const singlePartValue = document.getElementById('quiz-single-part-value');

    if (multiPartSlider && singlePartSlider) {
        multiPartSlider.addEventListener('input', function() {
            const val = parseInt(this.value);
            singlePartSlider.value = String(100 - val);
            if (multiPartValue) multiPartValue.textContent = val + '%';
            if (singlePartValue) singlePartValue.textContent = (100 - val) + '%';
            appState.settings.quizMultiPartProbability = val;
            appState.settings.quizSinglePartProbability = 100 - val;
        });

        singlePartSlider.addEventListener('input', function() {
            const val = parseInt(this.value);
            multiPartSlider.value = String(100 - val);
            if (singlePartValue) singlePartValue.textContent = val + '%';
            if (multiPartValue) multiPartValue.textContent = (100 - val) + '%';
            appState.settings.quizMultiPartProbability = 100 - val;
            appState.settings.quizSinglePartProbability = val;
        });
    }

    // 发音语速滑块
    const playbackRateSlider = document.getElementById('playback-rate') as HTMLInputElement;
    const playbackRateValue = document.getElementById('playback-rate-value');
    const playbackRateTest = document.getElementById('playback-rate-test');
    if (playbackRateSlider) {
        playbackRateSlider.addEventListener('input', function() {
            const rate = parseFloat(this.value) || 1.0;
            appState.settings.playbackRate = rate;
            if (playbackRateValue) playbackRateValue.textContent = rate.toFixed(1) + 'x';
        });
    }
    if (playbackRateTest) {
        playbackRateTest.addEventListener('click', (e: Event) => {
            e.preventDefault();
            const type = appState.settings.pronunciationType || 'us';
            void playPronunciation(type, 'hello');
        });
    }

    if (saveSettingsBtn) {
        saveSettingsBtn.addEventListener('click', function() {
            saveSettings();
        });
    }

    if (clearCacheBtn) {
        clearCacheBtn.addEventListener('click', function() {
            clearAllData();
        });
    }

    initAssetDownloads();
    initPronunciationBulkDownload();

    // API密钥设置弹窗
    const apiSettingsLink = document.getElementById('api-settings-link');
    const apiSettingsModal = document.getElementById('api-settings-modal');
    const apiSettingsClose = document.getElementById('api-settings-close');
    const apiSettingsCancel = document.getElementById('api-settings-cancel');
    const apiSettingsSave = document.getElementById('api-settings-save');

    function openApiSettingsModal() {
        if (!apiSettingsModal) return;
        const sidInput = document.getElementById('tencent-secret-id') as HTMLInputElement;
        const skeyInput = document.getElementById('tencent-secret-key') as HTMLInputElement;
        try {
            const raw = localStorage.getItem('tencent_api_keys');
            if (raw) {
                const keys = JSON.parse(raw);
                if (sidInput) sidInput.value = keys.secretId || '';
                if (skeyInput) skeyInput.value = keys.secretKey || '';
            }
        } catch {}
        openModal(apiSettingsModal);
    }
    function closeApiSettingsModal() {
        if (!apiSettingsModal) return;
        // 清掉输入框中未保存的值
        closeModal(apiSettingsModal);
    }

    if (apiSettingsLink && apiSettingsModal) {
        apiSettingsLink.addEventListener('click', (e: Event) => {
            e.preventDefault();
            openApiSettingsModal();
        });
    }
    if (apiSettingsClose) apiSettingsClose.addEventListener('click', closeApiSettingsModal);
    if (apiSettingsCancel) apiSettingsCancel.addEventListener('click', closeApiSettingsModal);
    if (apiSettingsModal) {
        apiSettingsModal.addEventListener('click', (e: MouseEvent) => {
            if (e.target === apiSettingsModal) closeApiSettingsModal();
        });
    }
    if (apiSettingsSave) {
        apiSettingsSave.addEventListener('click', () => {
            const sidInput = document.getElementById('tencent-secret-id') as HTMLInputElement;
            const skeyInput = document.getElementById('tencent-secret-key') as HTMLInputElement;
            const secretId = sidInput?.value.trim() || '';
            const secretKey = skeyInput?.value.trim() || '';
            // 两个都为空 → 清除自定义密钥（使用默认值）；两个都有值 → 保存
            if ((secretId && !secretKey) || (!secretId && secretKey)) {
                showToast('请同时填写 Secret ID 和 Secret Key，或都留空使用默认密钥', 'error');
                return;
            }
            if (secretId && secretKey) {
                localStorage.setItem('tencent_api_keys', JSON.stringify({ secretId, secretKey }));
                showToast('API密钥已保存，后续翻译将使用新密钥', 'success');
            } else {
                localStorage.removeItem('tencent_api_keys');
                showToast('已恢复使用默认密钥', 'success');
            }
            closeApiSettingsModal();
        });
    }

    // 数据资源管理弹窗
    const assetManageLink = document.getElementById('asset-manage-link');
    const assetManageModal = document.getElementById('asset-manage-modal');
    const assetManageClose = document.getElementById('asset-manage-close');
    const assetManageDone = document.getElementById('asset-manage-done');

    function openAssetManageModal() {
        if (!assetManageModal) return;
        // 打开时刷新一次状态
        void fetchAssetStatus();
        void fetchPronunciationDownloadStatus();
        openModal(assetManageModal);
    }
    function closeAssetManageModal() {
        if (!assetManageModal) return;
        closeModal(assetManageModal);
    }

    if (assetManageLink && assetManageModal) {
        assetManageLink.addEventListener('click', (e: Event) => {
            e.preventDefault();
            openAssetManageModal();
        });
    }
    if (assetManageClose) assetManageClose.addEventListener('click', closeAssetManageModal);
    if (assetManageDone) assetManageDone.addEventListener('click', closeAssetManageModal);
    if (assetManageModal) {
        assetManageModal.addEventListener('click', (e: MouseEvent) => {
            if (e.target === assetManageModal) closeAssetManageModal();
        });
    }

    if (_settingsKeyupHandler) {
        document.removeEventListener('keyup', _settingsKeyupHandler);
    }
    _settingsKeyupHandler = function(e: KeyboardEvent) {
        const quizAnswerInput = document.getElementById("quiz-answer") as HTMLInputElement;
        const quizContainer = document.getElementById("quiz-container");
        const quizModeSelect = document.getElementById("quiz-mode") as HTMLSelectElement;
        const isQuizFocused = quizAnswerInput && document.activeElement === quizAnswerInput;
        const isQuizContainerVisible = quizContainer && quizContainer.classList.contains('quiz-container-visible');
        const isEnToZhMode = quizModeSelect && quizModeSelect.value === QuizMode.EnToZh;

        let shouldDisableShortcuts = false;

        if (document.querySelector('.modal-overlay[style*="flex"], .modal-overlay.modal-visible')) {
            shouldDisableShortcuts = true;
        }

        if (isEnToZhMode && appState.isInInputCooldown) {
            shouldDisableShortcuts = true;
        }

        if (isEnToZhMode && quizAnswerInput && !shouldDisableShortcuts) {
            const inputText = quizAnswerInput.value.trim();
            if (inputText.length > 0 && !hasChinese(inputText)) {
                shouldDisableShortcuts = true;
            }
        }

        if (isQuizFocused && isQuizContainerVisible && /^[0-9]$/.test(e.key)) {
            if (shouldDisableShortcuts) {
                return;
            }
            e.preventDefault();
            if (e.key === appState.settings.answerKey) {
                if (!debounceTimer) {
                    showAnswer();
                    debounceTimer = setTimeout(() => {
                        debounceTimer = null;
                    }, 100);
                }
                return;
            }
            if (e.key === appState.settings.playPronunciationKey && appState.currentQuizWord) {
                playPronunciation(appState.settings.pronunciationType, appState.currentQuizWord.word);
                return;
            }
            if (e.key === appState.settings.addToFavoritesKeyInQuiz && appState.isWaitingForNextQuestion && appState.currentQuizWord) {
                quizAddToFavorites();
                return;
            }
            return;
        }

        if ((e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) && !isQuizFocused) {
            return;
        }

        if (e.key === appState.settings.answerKey && isQuizContainerVisible && !shouldDisableShortcuts) {
            if (!debounceTimer) {
                showAnswer();
                debounceTimer = setTimeout(() => {
                    debounceTimer = null;
                }, 100);
            }
        }

        if (e.key === appState.settings.playPronunciationKey && isQuizContainerVisible && appState.currentQuizWord) {
            playPronunciation(appState.settings.pronunciationType, appState.currentQuizWord.word);
        }

        if (e.key === appState.settings.addToFavoritesKeyInQuiz && isQuizContainerVisible && appState.isWaitingForNextQuestion && appState.currentQuizWord) {
            quizAddToFavorites();
        }
    };
    document.addEventListener('keyup', _settingsKeyupHandler);
}

export function loadSettings(): void {
    const savedSettings = localStorage.getItem('quizSettings');
    if (savedSettings) {
        const parsed = JSON.parse(savedSettings);
        // 合并默认设置和已保存的设置，确保新字段有默认值
        Object.assign(appState.settings, {
            pronunciationType: PronunciationType.US,
            chineseCount: 1,
            showAllMeanings: false,
            answerKey: '1',
            playPronunciationKey: '2',
            addToWordlistKey: '1',
            addToFavoritesKey: '2',
            addToFavoritesKeyInQuiz: '3',
            addToErrorbookAfterShowAnswer: false,
            errorCorrectCount: 3,
            autoPlayPronunciationAfterErrors: 2,
            quizOrder: QuizOrder.Random,
            quizWordCount: 10,
            searchHistoryCount: 20,
            enableEbbinghaus: true,
            quizMultiPartProbability: 50,
            quizSinglePartProbability: 50,
            quizMode: QuizMode.ZhToEn,
            wordSource: WordSource.Favorites,
            quizCount: 10,
            dailyWordCount: 20,
            soundEnabled: true,
            semanticSimilarityEnabled: true,
            ...parsed
        });
    }

    const pronunciationType = document.getElementById('pronunciation-type') as HTMLSelectElement;
    const chineseCount = document.getElementById('chinese-count') as HTMLSelectElement;
    const showAllMeanings = document.getElementById('show-all-meanings') as HTMLInputElement;
    const answerKey = document.getElementById('answer-key') as HTMLInputElement;
    const playPronunciationKey = document.getElementById('play-pronunciation-key') as HTMLInputElement;
    const addToWordlistKey = document.getElementById('add-to-wordlist-key') as HTMLInputElement;
    const addToFavoritesKey = document.getElementById('add-to-favorites-key') as HTMLInputElement;
    const errorCorrectCount = document.getElementById('error-correct-count') as HTMLInputElement;
    const autoPlayPronunciationAfterErrors = document.getElementById('auto-play-pronunciation-after-errors') as HTMLInputElement;
    const addToFavoritesKeyInQuiz = document.getElementById('add-to-favorites-key-in-quiz') as HTMLInputElement;
    const autoAddErrorbook = document.getElementById('auto-add-errorbook') as HTMLInputElement;
    const soundEnabled = document.getElementById('sound-enabled') as HTMLInputElement;
    const semanticSimilarityEnabled = document.getElementById('semantic-similarity-enabled') as HTMLInputElement;

    if (pronunciationType) pronunciationType.value = appState.settings.pronunciationType;
    if (chineseCount) chineseCount.value = String(appState.settings.chineseCount);
    if (showAllMeanings) showAllMeanings.checked = appState.settings.showAllMeanings;
    if (answerKey) answerKey.value = appState.settings.answerKey;
    if (playPronunciationKey) playPronunciationKey.value = appState.settings.playPronunciationKey || '2';
    if (addToWordlistKey) addToWordlistKey.value = appState.settings.addToWordlistKey || '1';
    if (addToFavoritesKey) addToFavoritesKey.value = appState.settings.addToFavoritesKey || '2';
    if (addToFavoritesKeyInQuiz) addToFavoritesKeyInQuiz.value = appState.settings.addToFavoritesKeyInQuiz || '3';
    if (autoAddErrorbook) autoAddErrorbook.checked = appState.settings.addToErrorbookAfterShowAnswer || false;
    if (soundEnabled) soundEnabled.checked = appState.settings.soundEnabled !== false;
    if (semanticSimilarityEnabled) semanticSimilarityEnabled.checked = appState.settings.semanticSimilarityEnabled !== false;
    const playbackRateSlider = document.getElementById('playback-rate') as HTMLInputElement;
    const playbackRateValue = document.getElementById('playback-rate-value');
    if (playbackRateSlider) {
        const rate = appState.settings.playbackRate ?? 1.0;
        playbackRateSlider.value = String(rate);
        if (playbackRateValue) playbackRateValue.textContent = rate.toFixed(1) + 'x';
    }
    if (errorCorrectCount) errorCorrectCount.value = String(appState.settings.errorCorrectCount || 3);
    if (autoPlayPronunciationAfterErrors) autoPlayPronunciationAfterErrors.value = String(appState.settings.autoPlayPronunciationAfterErrors ?? 2);

    const searchHistoryCount = document.getElementById('search-history-count') as HTMLInputElement;
    if (searchHistoryCount) {
        searchHistoryCount.value = String(appState.settings.searchHistoryCount || 20);
    }
    const enableEbbinghaus = document.getElementById('enable-ebbinghaus') as HTMLInputElement;
    if (enableEbbinghaus) {
        enableEbbinghaus.checked = appState.settings.enableEbbinghaus !== false;
    }

    const multiPartProb = document.getElementById('quiz-multi-part-probability') as HTMLInputElement;
    const singlePartProb = document.getElementById('quiz-single-part-probability') as HTMLInputElement;
    const multiPartValue = document.getElementById('quiz-multi-part-value');
    const singlePartValue = document.getElementById('quiz-single-part-value');

    if (multiPartProb && singlePartProb) {
        const multiValue = appState.settings.quizMultiPartProbability || 50;
        const singleValue = 100 - multiValue;
        multiPartProb.value = String(multiValue);
        if (multiPartValue) multiPartValue.textContent = multiValue + '%';
        singlePartProb.value = String(singleValue);
        if (singlePartValue) singlePartValue.textContent = singleValue + '%';
        appState.settings.quizSinglePartProbability = singleValue;
    }

    const quizMode = document.getElementById('quiz-mode') as HTMLSelectElement;
    if (quizMode) {
        quizMode.value = appState.settings.quizMode || QuizMode.ZhToEn;
    }
    const wordSource = document.getElementById('word-source') as HTMLSelectElement;
    if (wordSource) {
        wordSource.value = appState.settings.wordSource || WordSource.Favorites;
    }
    const quizCount = document.getElementById('quiz-count') as HTMLInputElement;
    if (quizCount) {
        quizCount.value = String(appState.settings.quizCount || 10);
    }
    const quizOrder = document.getElementById('quiz-order') as HTMLSelectElement;
    if (quizOrder) {
        quizOrder.value = appState.settings.quizOrder || QuizOrder.Random;
    }
    const dailyWordCount = document.getElementById('daily-word-count') as HTMLInputElement;
    if (dailyWordCount) {
        dailyWordCount.value = String(appState.settings.dailyWordCount || 20);
    }
    updateTomorrowWords();
}

export function saveSettings(): void {
    const pronunciationType = document.getElementById('pronunciation-type') as HTMLSelectElement;
    const chineseCount = document.getElementById('chinese-count') as HTMLSelectElement;
    const showAllMeanings = document.getElementById('show-all-meanings') as HTMLInputElement;
    const answerKey = document.getElementById('answer-key') as HTMLInputElement;
    const playPronunciationKey = document.getElementById('play-pronunciation-key') as HTMLInputElement;
    const addToWordlistKey = document.getElementById('add-to-wordlist-key') as HTMLInputElement;
    const addToFavoritesKey = document.getElementById('add-to-favorites-key') as HTMLInputElement;
    const addToFavoritesKeyInQuiz = document.getElementById('add-to-favorites-key-in-quiz') as HTMLInputElement;
    const autoAddErrorbook = document.getElementById('auto-add-errorbook') as HTMLInputElement;
    const errorCorrectCount = document.getElementById('error-correct-count') as HTMLInputElement;
    const autoPlayPronunciationAfterErrors = document.getElementById('auto-play-pronunciation-after-errors') as HTMLInputElement;
    const searchHistoryCount = document.getElementById('search-history-count') as HTMLInputElement;
    const enableEbbinghaus = document.getElementById('enable-ebbinghaus') as HTMLInputElement;
    const soundEnabled = document.getElementById('sound-enabled') as HTMLInputElement;
    const semanticSimilarityEnabled = document.getElementById('semantic-similarity-enabled') as HTMLInputElement;
    const multiPartProb = document.getElementById('quiz-multi-part-probability') as HTMLInputElement;
    const singlePartProb = document.getElementById('quiz-single-part-probability') as HTMLInputElement;

    if (pronunciationType) appState.settings.pronunciationType = pronunciationType.value as PronunciationType;
    if (chineseCount) appState.settings.chineseCount = parseInt(chineseCount.value);
    if (showAllMeanings) appState.settings.showAllMeanings = showAllMeanings.checked;

    const newAnswerKey = answerKey ? answerKey.value : appState.settings.answerKey;
    const newPlayPronunciationKey = playPronunciationKey ? playPronunciationKey.value : appState.settings.playPronunciationKey;
    const newAddToWordlistKey = addToWordlistKey ? addToWordlistKey.value : appState.settings.addToWordlistKey;
    const newAddToFavoritesKey = addToFavoritesKey ? addToFavoritesKey.value : appState.settings.addToFavoritesKey;
    const newAddToFavoritesKeyInQuiz = addToFavoritesKeyInQuiz ? addToFavoritesKeyInQuiz.value : appState.settings.addToFavoritesKeyInQuiz;

    const quizKeys = [newAnswerKey, newPlayPronunciationKey, newAddToFavoritesKeyInQuiz].filter(Boolean);
    if (new Set(quizKeys).size !== quizKeys.length) {
        void showAlert('测验页面的快捷键存在冲突，请更换后再保存。');
        return;
    }
    if (newAddToWordlistKey && newAddToFavoritesKey && newAddToWordlistKey === newAddToFavoritesKey) {
        void showAlert(`词典页面的 "加入单词本快捷键" 和 "收藏快捷键" 冲突（都是 ${newAddToWordlistKey}），请更换其中一个后再保存。`);
        return;
    }

    if (answerKey) appState.settings.answerKey = newAnswerKey;
    if (playPronunciationKey) appState.settings.playPronunciationKey = newPlayPronunciationKey || '2';
    if (addToWordlistKey) appState.settings.addToWordlistKey = newAddToWordlistKey || '1';
    if (addToFavoritesKey) appState.settings.addToFavoritesKey = newAddToFavoritesKey || '2';
    if (addToFavoritesKeyInQuiz) appState.settings.addToFavoritesKeyInQuiz = newAddToFavoritesKeyInQuiz || '3';
    if (autoAddErrorbook) appState.settings.addToErrorbookAfterShowAnswer = autoAddErrorbook.checked;
    if (errorCorrectCount) appState.settings.errorCorrectCount = parseInt(errorCorrectCount.value);
    if (autoPlayPronunciationAfterErrors) appState.settings.autoPlayPronunciationAfterErrors = parseInt(autoPlayPronunciationAfterErrors.value) || 0;
    if (searchHistoryCount) appState.settings.searchHistoryCount = parseInt(searchHistoryCount.value);
    if (enableEbbinghaus) appState.settings.enableEbbinghaus = enableEbbinghaus.checked;
    if (soundEnabled) appState.settings.soundEnabled = soundEnabled.checked;
    if (semanticSimilarityEnabled) appState.settings.semanticSimilarityEnabled = semanticSimilarityEnabled.checked;
    const playbackRateSlider = document.getElementById('playback-rate') as HTMLInputElement;
    if (playbackRateSlider) {
        appState.settings.playbackRate = parseFloat(playbackRateSlider.value) || 1.0;
    }
    if (multiPartProb) appState.settings.quizMultiPartProbability = parseInt(multiPartProb.value);
    if (singlePartProb) appState.settings.quizSinglePartProbability = parseInt(singlePartProb.value);

    const quizMode = document.getElementById('quiz-mode') as HTMLSelectElement;
    if (quizMode) {
        appState.settings.quizMode = quizMode.value as QuizMode;
    }
    const wordSource = document.getElementById('word-source') as HTMLSelectElement;
    if (wordSource) {
        appState.settings.wordSource = wordSource.value as WordSource;
    }
    const quizCount = document.getElementById('quiz-count') as HTMLInputElement;
    if (quizCount) {
        appState.settings.quizCount = parseInt(quizCount.value);
    }
    const quizOrder = document.getElementById('quiz-order') as HTMLSelectElement;
    if (quizOrder) {
        appState.settings.quizOrder = quizOrder.value as QuizOrder;
    }
    const dailyWordCount = document.getElementById('daily-word-count') as HTMLInputElement;
    if (dailyWordCount) {
        appState.settings.dailyWordCount = parseInt(dailyWordCount.value);
    }

    // 注意：store 已在每次属性写入时自动同步 localStorage，此处只需在保存 UI 后触发副作用
    updateTomorrowWords();
    void showAlert('设置已保存');
}

export function saveQuizSettings(): void {
    const quizMode = document.getElementById('quiz-mode') as HTMLSelectElement;
    if (quizMode) {
        appState.settings.quizMode = quizMode.value as QuizMode;
    }
    const wordSource = document.getElementById('word-source') as HTMLSelectElement;
    if (wordSource) {
        appState.settings.wordSource = wordSource.value as WordSource;
    }
    const quizCount = document.getElementById('quiz-count') as HTMLInputElement;
    if (quizCount) {
        appState.settings.quizCount = parseInt(quizCount.value);
    }
    const quizOrder = document.getElementById('quiz-order') as HTMLSelectElement;
    if (quizOrder) {
        appState.settings.quizOrder = quizOrder.value as QuizOrder;
    }
    // store 自动持久化 quizSettings，无需手动写
}

export async function clearAllData(): Promise<void> {
    const ok = await showConfirm(
        '确定要清除所有数据吗？\n\n这将清除：\n- 本地存储数据（收藏、错题本、学习统计、学习历史等）\n- 服务器端用户单词本\n- 服务器翻译缓存\n- 音频缓存\n\n该操作不可恢复！',
        '清除所有数据'
    );
    if (!ok) return;

    try {
        const cacheResponse = await fetch('/api/cache/clear', {
            method: 'POST'
        });

        const result = await cacheResponse.json();
        if (!cacheResponse.ok) {
            throw new Error(result.error?.message || result.message || '服务器清除数据失败');
        }

        const wordbookResponse = await fetch('/api/wordbook/clear', {
            method: 'POST'
        });
        if (!wordbookResponse.ok) {
            const wordbookResult = await wordbookResponse.json().catch(() => ({}));
            throw new Error(wordbookResult.error?.message || wordbookResult.message || '清空单词本失败');
        }

        localStorage.clear();

        if (window.caches) {
            try {
                const cacheKeys = await caches.keys();
                await Promise.all(cacheKeys.map(key => caches.delete(key)));
            } catch (e: unknown) {
            }
        }

        Object.assign(appState.settings, {
            pronunciationType: PronunciationType.US,
            chineseCount: 1,
            showAllMeanings: false,
            answerKey: '1',
            playPronunciationKey: '2',
            addToWordlistKey: '1',
            addToFavoritesKey: '2',
            addToFavoritesKeyInQuiz: '3',
            addToErrorbookAfterShowAnswer: false,
            errorCorrectCount: 3,
            autoPlayPronunciationAfterErrors: 2,
            quizOrder: QuizOrder.Random,
            quizWordCount: 10,
            searchHistoryCount: 20,
            enableEbbinghaus: true,
            quizMultiPartProbability: 50,
            quizSinglePartProbability: 50,
            soundEnabled: true,
            semanticSimilarityEnabled: true,
            // 补齐此前漏重置的字段，与 store/getDefaultState 保持一致
            playbackRate: 1.0,
            dailyWordCount: 20,
            quizMode: QuizMode.ZhToEn,
            wordSource: WordSource.Favorites,
            quizCount: 10
        });

        loadSettings();

        try {
            updateStudyStats();
            updateWordbookSelect();
            updateSelectedWordbookDisplay();
            updateFavoritesDisplay();
            updateErrorbookDisplay();
        } catch (e: unknown) {
            // UI 刷新失败不影响清除结果
            console.error('清除数据后刷新界面失败:', e);
        }

        let message = '数据清除成功！\n\n';
        message += '服务器端已清除: ' + (result.data?.cleared_items?.join(', ') || '无');
        if (result.data?.errors?.length) {
            message += '\n\n部分项未清除:\n' + result.data.errors.join('\n');
        }
        message += '\n\n页面将在3秒后刷新...';

        await showAlert(message, '清除成功');

        setTimeout(() => {
            location.reload();
        }, 3000);

    } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error('清除数据失败:', error);
        await showAlert('清除数据时出错：' + msg);
    }
}

export function showImportFormat(): void {
    const modal = document.getElementById('import-format-modal');
    if (modal) {
        openModal(modal);
    }
}

// ==================== 离线发音包批量下载 ====================

interface PronunciationDownloadStatus {
    total: number;
    completed: number;
    failed: number;
    pending: number;
    inProgress: boolean;
    paused: boolean;
    percent: number;
    accent: string;
}

let pronunciationDownloadPollTimer: ReturnType<typeof setInterval> | null = null;

function getOrCreatePronunciationItemEl(container: HTMLElement): HTMLElement {
    let item = container.querySelector('[data-asset-id="pronunciations"]') as HTMLElement | null;
    if (item) return item;

    item = document.createElement('div');
    item.className = 'asset-download-item';
    item.dataset.assetId = 'pronunciations';
    item.innerHTML = `
        <div class="asset-download-main">
            <div class="asset-download-info">
                <span class="asset-name">离线发音包</span>
                <span class="asset-tag optional">可选</span>
                <span class="asset-size">-</span>
                <span class="asset-status not-downloaded">未下载</span>
            </div>
            <div class="asset-action-btns">
                <select class="setting-select pronunciation-accent-select" aria-label="发音口音">
                    <option value="us">美式发音</option>
                    <option value="uk">英式发音</option>
                </select>
                <button class="asset-download-btn secondary pronunciation-pause-btn" style="display:none;">暂停</button>
                <button class="asset-download-btn pronunciation-action-btn">下载</button>
                <button class="asset-download-btn danger pronunciation-clear-btn" style="display:none;">清空</button>
            </div>
        </div>
        <div class="asset-progress-area pronunciation-progress-area" style="display:none;">
            <div class="asset-progress-bar"><div class="asset-progress-fill"></div></div>
            <span class="asset-progress-text pronunciation-progress-text">0%</span>
        </div>
    `;

    const actionBtn = item.querySelector('.pronunciation-action-btn') as HTMLButtonElement;
    const pauseBtn = item.querySelector('.pronunciation-pause-btn') as HTMLButtonElement;
    const clearBtn = item.querySelector('.pronunciation-clear-btn') as HTMLButtonElement;
    const accentSelect = item.querySelector('.pronunciation-accent-select') as HTMLSelectElement;

    actionBtn.addEventListener('click', () => {
        if (actionBtn.textContent === '继续') {
            void continuePronunciationDownload();
        } else {
            void startPronunciationDownload(accentSelect.value);
        }
    });
    pauseBtn.addEventListener('click', () => void pausePronunciationDownload());
    clearBtn.addEventListener('click', () => void clearPronunciationCacheUI());

    container.appendChild(item);
    return item;
}

function updatePronunciationDownloadUI(status: PronunciationDownloadStatus): void {
    const container = document.getElementById('asset-downloads-list');
    if (!container) return;
    const item = getOrCreatePronunciationItemEl(container);
    // 确保离线发音包始终位于资源列表末尾
    container.appendChild(item);
    const statusEl = item.querySelector('.asset-status') as HTMLElement;
    const actionBtn = item.querySelector('.pronunciation-action-btn') as HTMLButtonElement;
    const pauseBtn = item.querySelector('.pronunciation-pause-btn') as HTMLButtonElement;
    const clearBtn = item.querySelector('.pronunciation-clear-btn') as HTMLButtonElement;
    const accentSelect = item.querySelector('.pronunciation-accent-select') as HTMLSelectElement;
    const area = item.querySelector('.pronunciation-progress-area') as HTMLElement;
    const fill = item.querySelector('.asset-progress-fill') as HTMLElement;
    const text = item.querySelector('.pronunciation-progress-text') as HTMLElement;

    const inProgress = status.inProgress;
    const paused = status.paused;
    const done = status.total - status.pending;

    const isDownloaded = done === status.total && status.total > 0;

    if (inProgress || paused || (!isDownloaded && (status.completed > 0 || status.pending > 0))) {
        area.style.display = 'flex';
    } else {
        area.style.display = 'none';
    }

    fill.style.width = `${status.percent}%`;
    text.textContent = `${status.percent}% (${done}/${status.total})`;

    if (accentSelect) {
        if (status.accent && (status.accent === 'us' || status.accent === 'uk')) {
            accentSelect.value = status.accent;
        }
        accentSelect.disabled = inProgress || paused;
    }

    if (inProgress) {
        statusEl.textContent = '下载中';
        statusEl.className = 'asset-status not-downloaded';
        actionBtn.textContent = '下载中';
        actionBtn.disabled = true;
        pauseBtn.style.display = 'inline-block';
        clearBtn.style.display = 'none';
    } else if (paused) {
        statusEl.textContent = '已暂停';
        statusEl.className = 'asset-status not-downloaded';
        actionBtn.textContent = '继续';
        actionBtn.disabled = false;
        pauseBtn.style.display = 'none';
        clearBtn.style.display = done > 0 ? 'inline-block' : 'none';
    } else if (done === status.total && status.total > 0) {
        statusEl.textContent = '已下载';
        statusEl.className = 'asset-status downloaded';
        actionBtn.textContent = '重新下载';
        actionBtn.disabled = false;
        pauseBtn.style.display = 'none';
        clearBtn.style.display = 'inline-block';
    } else {
        statusEl.textContent = '未下载';
        statusEl.className = 'asset-status not-downloaded';
        actionBtn.textContent = '下载';
        actionBtn.disabled = false;
        pauseBtn.style.display = 'none';
        clearBtn.style.display = 'none';
    }
}

async function startPronunciationDownload(accent: string): Promise<void> {
    try {
        const response = await fetch('/api/pronunciations/download/start', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ accent })
        });
        const result = await response.json();
        if (result.success) {
            updatePronunciationDownloadUI(result.data);
            showToast('已开始下载离线发音包');
        } else {
            showToast(result.error?.message || '启动失败');
        }
    } catch (e) {
        console.error('[settings] 启动发音下载失败:', e);
        showToast('启动下载失败');
    }
}

async function continuePronunciationDownload(): Promise<void> {
    const accentSelect = document.querySelector('.pronunciation-accent-select') as HTMLSelectElement | null;
    const accent = accentSelect?.value || 'us';
    await startPronunciationDownload(accent);
}

async function pausePronunciationDownload(): Promise<void> {
    try {
        const response = await fetch('/api/pronunciations/download/pause', { method: 'POST' });
        const result = await response.json();
        if (result.success) {
            updatePronunciationDownloadUI(result.data);
            showToast('已暂停下载');
        }
    } catch (e) {
        console.error('[settings] 暂停发音下载失败:', e);
    }
}

async function clearPronunciationCacheUI(): Promise<void> {
    const ok = await showConfirm('确定要清空离线发音包缓存吗？清空后需要重新下载。');
    if (!ok) return;
    try {
        const response = await fetch('/api/pronunciations/clear', { method: 'POST' });
        const result = await response.json();
        if (result.success) {
            showToast(result.message || '已清空离线发音包缓存');
            void fetchPronunciationDownloadStatus();
        } else {
            showToast(result.error?.message || '清空失败', 'error');
        }
    } catch (e) {
        console.error('[settings] 清空发音缓存失败:', e);
        showToast('清空失败', 'error');
    }
}

async function fetchPronunciationDownloadStatus(): Promise<PronunciationDownloadStatus | null> {
    try {
        const response = await fetch('/api/pronunciations/download/status');
        const result = await response.json();
        if (result.success && result.data) {
            updatePronunciationDownloadUI(result.data);
            return result.data as PronunciationDownloadStatus;
        }
    } catch (e) {
        console.error('[settings] 获取发音下载状态失败:', e);
    }
    return null;
}

function startPollingPronunciationDownloadStatus(): void {
    if (pronunciationDownloadPollTimer) return;
    pronunciationDownloadPollTimer = setInterval(() => {
        void fetchPronunciationDownloadStatus();
    }, 1000);
}

function stopPollingPronunciationDownloadStatus(): void {
    if (pronunciationDownloadPollTimer) {
        clearInterval(pronunciationDownloadPollTimer);
        pronunciationDownloadPollTimer = null;
    }
}

function initPronunciationBulkDownload(): void {
    const container = document.getElementById('asset-downloads-list');
    if (!container) {
        console.warn('[settings] 找不到资源下载容器，离线发音包初始化失败');
        return;
    }

    getOrCreatePronunciationItemEl(container);
    void fetchPronunciationDownloadStatus();
}

// ==================== 数据资源下载 ====================

export function jumpToSettings(): void {
    void switchPage('settings');
}

interface AssetStatusItem {
    id: string;
    name: string;
    description: string;
    required: boolean;
    size: number;
    downloaded: boolean;
}

interface AssetProgressItem {
    assetId: string;
    downloaded: number;
    total: number;
    percent: number;
}

let assetDownloadPollTimer: ReturnType<typeof setInterval> | null = null;
let assetStatusCache: AssetStatusItem[] = [];
const assetDownloadingState = new Map<string, boolean>();
const assetCompletedToasts = new Set<string>();

function formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function getAssetNameById(assetId: string): string {
    const asset = assetStatusCache.find(a => a.id === assetId);
    return asset?.name || assetId;
}

function getOrCreateAssetItemEl(container: HTMLElement, asset: AssetStatusItem): HTMLElement {
    let item = container.querySelector(`[data-asset-id="${asset.id}"]`) as HTMLElement | null;
    if (item) return item;

    item = document.createElement('div');
    item.className = 'asset-download-item';
    item.dataset.assetId = asset.id;
    item.innerHTML = `
        <div class="asset-download-main">
            <div class="asset-download-info">
                <span class="asset-name"></span>
                <span class="asset-tag required">必需</span>
                <span class="asset-tag optional">可选</span>
                <span class="asset-size"></span>
                <span class="asset-status"></span>
            </div>
            <div class="asset-action-btns">
                <button class="asset-download-btn secondary asset-pause-btn" style="display:none;">暂停</button>
                <button class="asset-download-btn asset-action-btn">下载</button>
                <button class="asset-download-btn danger asset-delete-btn" style="display:none;">删除</button>
            </div>
        </div>
        <div class="asset-progress-area" style="display:none;">
            <div class="asset-progress-bar"><div class="asset-progress-fill"></div></div>
            <span class="asset-progress-text">0%</span>
        </div>
    `;
    const actionBtn = item.querySelector('.asset-action-btn') as HTMLButtonElement;
    const pauseBtn = item.querySelector('.asset-pause-btn') as HTMLButtonElement;
    const deleteBtn = item.querySelector('.asset-delete-btn') as HTMLButtonElement;
    actionBtn.addEventListener('click', () => handleAssetActionClick(asset.id));
    pauseBtn.addEventListener('click', () => pauseAssetDownloadUI(asset.id));
    deleteBtn.addEventListener('click', () => deleteAssetUI(asset.id));
    container.appendChild(item);
    return item;
}

function handleAssetActionClick(assetId: string): void {
    const isPaused = assetDownloadingState.get(assetId) === false;
    if (isPaused) {
        // 继续下载
        assetDownloadingState.set(assetId, true);
        void startAssetDownload(assetId, true);
    } else {
        void startAssetDownload(assetId, false);
    }
}

function updateAssetDownloadUI(assets: AssetStatusItem[]): void {
    const container = document.getElementById('asset-downloads-list');
    if (!container) return;

    assetStatusCache = assets;

    assets.forEach(asset => {
        const item = getOrCreateAssetItemEl(container, asset);
        const nameEl = item.querySelector('.asset-name') as HTMLElement;
        const requiredTag = item.querySelector('.asset-tag.required') as HTMLElement;
        const optionalTag = item.querySelector('.asset-tag.optional') as HTMLElement;
        const sizeEl = item.querySelector('.asset-size') as HTMLElement;
        const statusEl = item.querySelector('.asset-status') as HTMLElement;
        const actionBtn = item.querySelector('.asset-action-btn') as HTMLButtonElement;
        const pauseBtn = item.querySelector('.asset-pause-btn') as HTMLButtonElement;
        const deleteBtn = item.querySelector('.asset-delete-btn') as HTMLButtonElement;
        const area = item.querySelector('.asset-progress-area') as HTMLElement;

        nameEl.textContent = asset.name;
        sizeEl.textContent = formatBytes(asset.size);
        requiredTag.style.display = asset.required ? 'inline-block' : 'none';
        optionalTag.style.display = asset.required ? 'none' : 'inline-block';

        // 如果正在下载中，保持下载中状态，避免被状态接口覆盖
        if (assetDownloadingState.get(asset.id) === true) {
            statusEl.textContent = '下载中';
            statusEl.className = 'asset-status not-downloaded';
            actionBtn.textContent = '下载中';
            actionBtn.disabled = true;
            pauseBtn.style.display = 'inline-block';
            deleteBtn.style.display = 'none';
            return;
        }

        if (asset.downloaded) {
            statusEl.textContent = '已下载';
            statusEl.className = 'asset-status downloaded';
            actionBtn.textContent = asset.required ? '已下载' : '重新下载';
            actionBtn.disabled = asset.required;
            pauseBtn.style.display = 'none';
            deleteBtn.style.display = asset.required ? 'none' : 'inline-block';
            area.style.display = 'none';
        } else {
            const isPaused = assetDownloadingState.get(asset.id) === false;
            statusEl.textContent = isPaused ? '已暂停' : '未下载';
            statusEl.className = 'asset-status not-downloaded';
            actionBtn.textContent = isPaused ? '继续' : '下载';
            actionBtn.disabled = false;
            pauseBtn.style.display = 'none';
            deleteBtn.style.display = 'none';
        }
    });
}

function updateAssetProgress(progressMap: Record<string, AssetProgressItem>): void {
    const container = document.getElementById('asset-downloads-list');
    if (!container) return;

    Object.entries(progressMap).forEach(([assetId, progress]) => {
        const item = container.querySelector(`[data-asset-id="${assetId}"]`) as HTMLElement | null;
        if (!item) return;
        const area = item.querySelector('.asset-progress-area') as HTMLElement;
        const fill = item.querySelector('.asset-progress-fill') as HTMLElement;
        const text = item.querySelector('.asset-progress-text') as HTMLElement;
        const actionBtn = item.querySelector('.asset-action-btn') as HTMLButtonElement;
        const pauseBtn = item.querySelector('.asset-pause-btn') as HTMLButtonElement;
        const statusEl = item.querySelector('.asset-status') as HTMLElement;

        if (progress.percent > 0 && progress.percent < 100) {
            area.style.display = 'flex';
            fill.style.width = `${progress.percent}%`;
            text.textContent = `${progress.percent}%`;
            assetDownloadingState.set(assetId, true);
            actionBtn.textContent = '下载中';
            actionBtn.disabled = true;
            pauseBtn.style.display = 'inline-block';
            statusEl.textContent = '下载中';
            statusEl.className = 'asset-status not-downloaded';
        } else if (progress.percent >= 100) {
            area.style.display = 'none';
            assetDownloadingState.delete(assetId);
            const cachedAsset = assetStatusCache.find(a => a.id === assetId);
            const isRequired = cachedAsset?.required ?? false;
            if (isRequired) {
                actionBtn.textContent = '已下载';
                actionBtn.disabled = true;
            } else {
                actionBtn.textContent = '重新下载';
                actionBtn.disabled = false;
            }
            pauseBtn.style.display = 'none';
            statusEl.textContent = '已下载';
            statusEl.className = 'asset-status downloaded';
            if (!assetCompletedToasts.has(assetId)) {
                assetCompletedToasts.add(assetId);
                showToast(`${getAssetNameById(assetId)} 下载完成`, 'success');
                // 可选资源下载完成后提示用户重启生效
                const cachedAsset = assetStatusCache.find(a => a.id === assetId);
                if (!cachedAsset?.required) {
                    setTimeout(async () => {
                        const shouldRestart = await showConfirm(
                            `${getAssetNameById(assetId)} 下载完成，需要重启应用后才能生效。\n\n是否立即重启？`
                        );
                        if (shouldRestart) {
                            window.electronAPI?.restartApp?.();
                        }
                    }, 500);
                }
            }
            // 进度完成后立即刷新一次状态，避免状态和进度不一致
            void fetchAssetStatus();
        }
    });
}

async function fetchAssetStatus(): Promise<void> {
    try {
        const response = await fetch('/api/assets/status');
        const result = await response.json();
        if (result.success && result.data) {
            updateAssetDownloadUI(result.data as AssetStatusItem[]);
        }
    } catch (e) {
        console.error('[settings] 获取资源状态失败:', e);
    }
}

async function fetchAssetProgress(): Promise<void> {
    try {
        const response = await fetch('/api/assets/progress');
        const result = await response.json();
        if (result.success && result.data) {
            updateAssetProgress(result.data as Record<string, AssetProgressItem>);
        }
    } catch (e) {
        console.error('[settings] 获取下载进度失败:', e);
    }
}

async function startAssetDownload(assetId: string, isResume = false): Promise<void> {
    try {
        assetDownloadingState.set(assetId, true);
        const response = await fetch('/api/assets/download', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ assetId })
        });
        const result = await response.json();
        if (result.success) {
            showToast(`${isResume ? '继续' : '开始'}下载 ${getAssetNameById(assetId)}`);
            assetCompletedToasts.delete(assetId);
            void fetchAssetStatus();
        } else {
            assetDownloadingState.set(assetId, false);
            showToast(result.error?.message || '下载失败', 'error');
            void fetchAssetStatus();
        }
    } catch (e) {
        assetDownloadingState.set(assetId, false);
        console.error('[settings] 启动资源下载失败:', e);
        showToast('启动下载失败', 'error');
    }
}

async function pauseAssetDownloadUI(assetId: string): Promise<void> {
    try {
        const response = await fetch('/api/assets/download/pause', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ assetId })
        });
        const result = await response.json();
        if (result.success) {
            assetDownloadingState.set(assetId, false);
            showToast(`已暂停下载 ${getAssetNameById(assetId)}`);
            void fetchAssetStatus();
        } else {
            showToast(result.error?.message || '暂停失败', 'error');
        }
    } catch (e) {
        console.error('[settings] 暂停资源下载失败:', e);
        showToast('暂停失败', 'error');
    }
}

async function deleteAssetUI(assetId: string): Promise<void> {
    const asset = assetStatusCache.find(a => a.id === assetId);
    if (!asset || asset.required) {
        showToast('必需资源不能删除', 'error');
        return;
    }
    const ok = await showConfirm(`确定要删除「${asset.name}」吗？删除后该功能将无法使用，可重新下载。`);
    if (!ok) return;
    try {
        const response = await fetch('/api/assets/delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ assetId })
        });
        const result = await response.json();
        if (result.success) {
            assetDownloadingState.delete(assetId);
            assetCompletedToasts.delete(assetId);
            showToast(`已删除 ${asset.name}`);
            void fetchAssetStatus();
        } else {
            showToast(result.error?.message || '删除失败', 'error');
        }
    } catch (e) {
        console.error('[settings] 删除资源失败:', e);
        showToast('删除失败', 'error');
    }
}

function startPollingAssetStatus(): void {
    if (assetDownloadPollTimer) return;
    assetDownloadPollTimer = setInterval(() => {
        void fetchAssetStatus();
        void fetchAssetProgress();
    }, 1000);
}

function stopPollingAssetStatus(): void {
    if (assetDownloadPollTimer) {
        clearInterval(assetDownloadPollTimer);
        assetDownloadPollTimer = null;
    }
}

function initAssetDownloads(): void {
    const container = document.getElementById('asset-downloads-list');
    if (!container) {
        console.warn('[settings] 找不到资源下载容器');
        return;
    }
    void fetchAssetStatus();
}

/** 进入设置页面时启动轮询（资源下载状态需要实时更新） */
export function startSettingsPolling(): void {
    startPollingAssetStatus();
    startPollingPronunciationDownloadStatus();
}

/** 离开设置页面时停止轮询，避免不必要的网络请求 */
export function stopSettingsPolling(): void {
    stopPollingAssetStatus();
    stopPollingPronunciationDownloadStatus();
}

// 设置项拖拽排序：基于 pointer 事件 + 浮动 ghost + transform 挤压动画
const SETTING_SORT_ORDER_PREFIX = 'setting-sort-order-';

function getSavedOrder(containerKey: string): string[] {
    const raw = localStorage.getItem(SETTING_SORT_ORDER_PREFIX + containerKey);
    try {
        const saved = JSON.parse(raw || '[]');
        return Array.isArray(saved) ? saved : [];
    } catch (e: unknown) {
        return [];
    }
}

function saveSettingOrder(containerKey: string, order: string[]): void {
    try {
        localStorage.setItem(SETTING_SORT_ORDER_PREFIX + containerKey, JSON.stringify(order));
    } catch (e: unknown) {
        console.log('Save setting order failed', e);
    }
}

function applySavedOrderToContainer(container: HTMLElement, containerKey: string): void {
    const saved = getSavedOrder(containerKey);
    if (!saved || saved.length === 0) {
        return;
    }
    const elements = Array.from(container.querySelectorAll<HTMLElement>('.setting-item'));
    if (elements.length === 0) {
        return;
    }
    const keyToEl = new Map<string, HTMLElement>();
    elements.forEach(el => {
        const key = el.getAttribute('data-setting-key') || '';
        if (key) keyToEl.set(key, el);
    });
    const orderedEls: HTMLElement[] = [];
    for (const key of saved) {
        const el = keyToEl.get(key);
        if (el) {
            orderedEls.push(el);
            keyToEl.delete(key);
        }
    }
    keyToEl.forEach(el => orderedEls.push(el));
    orderedEls.forEach(el => container.appendChild(el));
}

// 拖拽状态（每次 pointerdown 重置，pointerup 清理）
interface DragState {
    container: HTMLElement;
    containerKey: string;
    sourceItem: HTMLElement;
    sourceIndex: number;
    items: HTMLElement[];          // 所有设置项的 DOM 引用（DOM 顺序）
    originalRects: DOMRect[];      // 每个 item 在拖动开始时的 rect（grid 位置）
    ghost: HTMLElement;             // 跟随鼠标的浮动副本
    offsetX: number;
    offsetY: number;
    targetIndex: number;            // 当前模拟的插入位置
    pointerId: number;
    hasMoved: boolean;
    lastMouseX: number;            // 最后一次 pointermove 的鼠标坐标（滚动时用来重新计算 target）
    lastMouseY: number;
}

let drag: DragState | null = null;

// 根据指针坐标计算应该插入到哪个索引（使用相对容器的坐标，避免滚动错位）
function computeTargetIndex(pointerX: number, pointerY: number): number {
    if (!drag) return 0;
    const { originalRects, items, container } = drag;
    if (items.length === 0) return 0;

    // 把 viewport 坐标转成相对容器的坐标（container.getBoundingClientRect 是实时的，滚动时自然变化）
    const containerRect = container.getBoundingClientRect();
    const x = pointerX - containerRect.left;
    const y = pointerY - containerRect.top;

    // originalRects 都是相对容器的坐标，计算整体 grid 边界
    let minLeft = Infinity, minTop = Infinity, maxRight = -Infinity, maxBottom = -Infinity;
    originalRects.forEach(r => {
        minLeft = Math.min(minLeft, r.left);
        minTop = Math.min(minTop, r.top);
        maxRight = Math.max(maxRight, r.right);
        maxBottom = Math.max(maxBottom, r.bottom);
    });

    if (y < minTop || x < minLeft) return 0;
    if (y > maxBottom) return items.length;
    if (x > maxRight) return items.length;

    let hitIdx = -1;
    for (let i = 0; i < items.length; i++) {
        const r = originalRects[i];
        if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
            hitIdx = i;
            break;
        }
    }
    if (hitIdx === -1) {
        let bestDist = Infinity;
        for (let i = 0; i < items.length; i++) {
            const r = originalRects[i];
            const cx = r.left + r.width / 2;
            const cy = r.top + r.height / 2;
            const d = (x - cx) * (x - cx) + (y - cy) * (y - cy);
            if (d < bestDist) {
                bestDist = d;
                hitIdx = i;
            }
        }
    }
    if (hitIdx === -1) return items.length;

    const hitRect = originalRects[hitIdx];
    const cx = hitRect.left + hitRect.width / 2;
    const cy = hitRect.top + hitRect.height / 2;
    // 用单元格对角线（左上→右下）判断插入方向，同时适配 1 行/1 列/2D 网格：
    //   在对角线上方（偏左上方向）→ 插入到当前项之前（targetIndex = hitIdx）
    //   在对角线下方（偏右下方向）→ 插入到当前项之后（targetIndex = hitIdx + 1）
    const diag = (x - cx) / hitRect.width + (y - cy) / hitRect.height;
    if (diag < 0) {
        return hitIdx;
    } else {
        return hitIdx + 1;
    }
}

// 根据当前 targetIndex，计算每个项的 transform 并应用
// 算法：把源项从 sourceIndex 位置"拿走"，插入到 targetIndex 位置，
//       其他项根据它们的 DOM 索引 i 判断应该前移一格还是后移一格。
function applyShifts(newTargetIndex: number): void {
    if (!drag) return;
    const { items, originalRects, sourceIndex } = drag;
    drag.targetIndex = newTargetIndex;

    for (let i = 0; i < items.length; i++) {
        const el = items[i];
        // 源项：保持半透明占位（is-dragging 类已加，不额外 transform）
        if (i === sourceIndex) {
            el.style.transform = '';
            continue;
        }

        // 计算该项在"虚拟新顺序"下应该占据的原始 grid 位置索引 newPos
        // 规则：
        //   如果 i 在 [targetIndex, sourceIndex) 之间（即拖到前面来）→ 这些项后移一格 → newPos = i + 1
        //   如果 i 在 (sourceIndex, targetIndex] 之间（即拖到后面去）→ 这些项前移一格 → newPos = i - 1
        //   其它 → newPos = i
        let newPos = i;
        if (newTargetIndex < sourceIndex) {
            // 向前拖：[targetIndex, sourceIndex) 的项向后移动一格
            if (i >= newTargetIndex && i < sourceIndex) {
                newPos = i + 1;
            }
        } else if (newTargetIndex > sourceIndex) {
            // 向后拖：(sourceIndex, targetIndex] 的项向前移动一格
            if (i > sourceIndex && i <= newTargetIndex) {
                newPos = i - 1;
            }
        } else {
            // 位置不变
            newPos = i;
        }

        // 计算 transform 偏移
        const curRect = originalRects[i];
        const targetRect = originalRects[newPos];
        const dx = targetRect.left - curRect.left;
        const dy = targetRect.top - curRect.top;

        if (dx === 0 && dy === 0) {
            el.style.transform = '';
        } else {
            el.style.transform = `translate(${dx}px, ${dy}px)`;
        }
    }
}

function clearShifts(): void {
    if (!drag) return;
    drag.items.forEach(el => {
        el.style.transform = '';
    });
}

// 给单个可排序容器绑定 pointer 事件（originalRects 用相对容器坐标，滚动时不会变化）
function bindSortableEvents(container: HTMLElement, containerKey: string): void {

    // 滚动/resize 时不需要重算 originalRects（相对容器坐标不受滚动影响），
    // 但需要重新计算一次 targetIndex，因为鼠标的 viewport 坐标和容器 rect 的相对关系可能变。
    const onScroll = () => {
        if (!drag || drag.containerKey !== containerKey) return;
        const newTarget = computeTargetIndex(drag.lastMouseX, drag.lastMouseY);
        if (newTarget !== drag.targetIndex) {
            applyShifts(newTarget);
        }
    };

    container.addEventListener('pointerdown', (e: PointerEvent) => {
        if (e.button !== 0 && e.pointerType === 'mouse') return;
        const target = e.target as HTMLElement;
        const item = target.closest('.setting-item') as HTMLElement | null;
        if (!item || !container.contains(item)) return;
        if (target.closest('input, select, textarea, a, button')) return;

        const items = Array.from(container.querySelectorAll<HTMLElement>('.setting-item'));
        const sourceIndex = items.indexOf(item);
        if (sourceIndex === -1) return;

        // 先拿容器的 viewport rect，用于把各项的 viewport rect 转成相对容器坐标
        const containerRect = container.getBoundingClientRect();

        // originalRects 存相对容器的坐标（不会因滚动变化，也不会受到 transform 影响——
        // 因为 pointerdown 时还没有任何 transform）
        const originalRects = items.map(el => {
            const r = el.getBoundingClientRect();
            return {
                left: r.left - containerRect.left,
                top: r.top - containerRect.top,
                right: r.right - containerRect.left,
                bottom: r.bottom - containerRect.top,
                width: r.width,
                height: r.height,
            } as DOMRect;
        });

        const sourceRect = originalRects[sourceIndex];
        // offsetX/Y 用 viewport 坐标（因为 ghost 用 fixed 定位，跟随鼠标 viewport 坐标）
        const clientSourceRect = item.getBoundingClientRect();
        const offsetX = e.clientX - clientSourceRect.left;
        const offsetY = e.clientY - clientSourceRect.top;

        const ghost = item.cloneNode(true) as HTMLElement;
        ghost.classList.add('drag-ghost');
        ghost.classList.remove('is-dragging');
        ghost.style.transition = 'none';
        ghost.style.width = clientSourceRect.width + 'px';
        ghost.style.height = clientSourceRect.height + 'px';
        ghost.style.transform = `translate(${clientSourceRect.left}px, ${clientSourceRect.top}px) scale(1.05)`;
        document.body.appendChild(ghost);

        item.classList.add('is-dragging');

        drag = {
            container,
            containerKey,
            sourceItem: item,
            sourceIndex,
            items,
            originalRects,
            ghost,
            offsetX,
            offsetY,
            targetIndex: sourceIndex,
            pointerId: e.pointerId,
            hasMoved: false,
            lastMouseX: e.clientX,
            lastMouseY: e.clientY,
        };

        try {
            (item as any).setPointerCapture?.(e.pointerId);
        } catch (err: unknown) {}

        e.preventDefault();
    });

    // pointermove 绑定到 document：鼠标离开容器范围仍可继续拖
    document.addEventListener('pointermove', (e: PointerEvent) => {
        if (!drag || e.pointerId !== drag.pointerId) return;
        drag.hasMoved = true;
        // 保存最后鼠标位置供滚动时重新计算 target
        drag.lastMouseX = e.clientX;
        drag.lastMouseY = e.clientY;

        const x = e.clientX - drag.offsetX;
        const y = e.clientY - drag.offsetY;
        // ghost 完全不使用 CSS transition，瞬间跟随
        drag.ghost.style.transform = `translate(${x}px, ${y}px) scale(1.05)`;

        const newTarget = computeTargetIndex(e.clientX, e.clientY);
        if (newTarget !== drag.targetIndex) {
            applyShifts(newTarget);
        }
    });

    // pointerup/pointercancel：完成拖拽
    const endDrag = (e: PointerEvent) => {
        if (!drag || e.pointerId !== drag.pointerId) return;
        const d = drag;
        drag = null;

        d.sourceItem.classList.remove('is-dragging');
        if (d.ghost.parentNode) d.ghost.parentNode.removeChild(d.ghost);

        if (d.targetIndex !== d.sourceIndex && d.targetIndex >= 0 && d.targetIndex <= d.items.length) {
            let refNode: Node | null = null;
            if (d.targetIndex < d.sourceIndex) {
                // 向前拖：插入到 items[targetIndex] 之前即可（前面的 items 不受 source 移除影响）
                if (d.targetIndex < d.items.length) {
                    const targetEl = d.items[d.targetIndex];
                    if (targetEl !== d.sourceItem) refNode = targetEl;
                }
            } else if (d.targetIndex > d.sourceIndex) {
                // 向后拖：source 被移除后，items[sourceIndex+1..targetIndex] 整体左移一位
                // 因此 targetIndex 位置上最终会是 items[targetIndex]（原位置 targetIndex 的元素）
                // 想把 source 放在"虚拟位置 targetIndex"，应该插入到 items[targetIndex] 之后
                if (d.targetIndex < d.items.length) {
                    const targetEl = d.items[d.targetIndex];
                    if (targetEl !== d.sourceItem) {
                        refNode = targetEl.nextSibling;
                    }
                }
                // targetIndex === items.length → refNode 保持 null → appendChild
            }
            if (refNode) {
                d.container.insertBefore(d.sourceItem, refNode);
            } else {
                d.container.appendChild(d.sourceItem);
            }

            const order = Array.from(d.container.querySelectorAll<HTMLElement>('.setting-item'))
                .map(el => el.getAttribute('data-setting-key') || '')
                .filter(Boolean);
            saveSettingOrder(d.containerKey, order);
        }

        // 给其他项一个平滑的"归位"动画（短暂使用 transition 后再清掉 transform）
        d.items.forEach(el => {
            el.style.transition = 'transform 0.22s cubic-bezier(0.2, 0.8, 0.2, 1)';
            el.style.transform = '';
        });
        window.setTimeout(() => {
            d.items.forEach(el => {
                el.style.transition = '';
            });
        }, 260);
    };

    document.addEventListener('pointerup', endDrag);
    document.addEventListener('pointercancel', endDrag);
    window.addEventListener('scroll', onScroll, true); // 捕获阶段，所有嵌套滚动都能监听
    window.addEventListener('resize', onScroll);
}

export function initSortableContainers(): void {
    const containers = document.querySelectorAll<HTMLElement>('.sortable-container');
    containers.forEach(container => {
        const containerKey = container.getAttribute('data-container') || '';
        if (!containerKey) return;
        applySavedOrderToContainer(container, containerKey);
        bindSortableEvents(container, containerKey);
    });
}


