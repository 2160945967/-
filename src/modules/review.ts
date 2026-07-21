// 复习模式：与测验模式相同的显示和判断逻辑，仅单词来源不同

import { appState, showConfirm, showAlert, escapeForJsString, escapeHtml } from '../global';
import { PronunciationType, QuizMode } from '../types/enums';
import { playPronunciation, playCorrectSound, playWrongSound, playCompleteSound, playClickSound } from '../utils/audio';
import { formatDefinitionHtml, normalizeNewlines } from '../utils/translation';
import { initErrorbookVue } from './errorbook';
import { updateStudyStats } from './stats';
import { loadSettings } from './settings';
import { loadWordbooks, updateWordSourceSelect, normalizeCaseByType } from './wordbook';
import { recordLearningHistory, showLearningHistory, calculateEbbinghausWeight } from './quiz';
import { setupImeHandling, setupEnterSubmission, setupGlobalShortcuts } from '../utils/quizCommon';
import { animateCorrectFeedback, animateErrorShake } from '../utils/gsap';
import {
    SessionState,
    createSession,
    markAnswered,
    endSessionWithSave,
    endSessionWithRollback,
    endSessionComplete,
    clearSessionState,
    loadSessionState,
    saveSessionState,
    updateSettingsButtons,
} from '../utils/quizSession';

interface ReviewWord {
    word: string;
    phonetic: string;
    meanings: Array<{ part: string; definition: string }>;
    isSentence?: boolean;
}

// 复习运行时状态
let reviewWords: ReviewWord[] = [];
let reviewIndex = 0;
let reviewCorrect = 0;
let reviewWrong = 0;
let reviewTotal = 0;
let reviewActive = false;
let reviewCurrentMode = QuizMode.EnToZh;
let reviewCurrentMeanings: { part: string; definition: string }[] = [];
let reviewCurrentErrorCount = 0;
let reviewShowAnswerCalled = false;
let reviewQuizInitialized = false;
let reviewShortcutsRemove: (() => void) | null = null;
let reviewEscHandler: ((e: KeyboardEvent) => void) | null = null;
let reviewSession: SessionState | null = null;

function showReviewAnswerArea(): void {
    const settings = document.getElementById('review-settings-area');
    const answer = document.getElementById('review-answer-area');
    if (settings) settings.style.display = 'none';
    if (answer) answer.style.display = 'block';
}

function showReviewSettingsArea(): void {
    const settings = document.getElementById('review-settings-area');
    const answer = document.getElementById('review-answer-area');
    const result = document.getElementById('review-result');
    if (settings) settings.style.display = 'block';
    if (answer) answer.style.display = 'none';
    if (result) {
        result.style.display = 'none';
        const handler = (result as any)._keyHandler;
        if (handler) {
            document.removeEventListener('keydown', handler);
            (result as any)._keyHandler = null;
        }
    }
    updateSettingsButtons('review');
}

export function initReviewQuiz(): void {
    const startBtn = document.getElementById('start-review');
    const showAnswerBtn = document.getElementById('review-show-answer');
    const nextBtn = document.getElementById('review-next-question');
    const answerInput = document.getElementById('review-answer') as HTMLInputElement;

    if (!reviewQuizInitialized) {
        if (startBtn) {
            startBtn.addEventListener('click', () => { playClickSound(); startReview(); });
        }
        if (showAnswerBtn) {
            showAnswerBtn.addEventListener('click', () => { playClickSound(); reviewShowAnswer(); });
        }
        if (nextBtn) {
            nextBtn.addEventListener('click', () => { playClickSound(); reviewNextQuestion(); });
        }

        // 继续/重开/结束按钮
        const continueBtn = document.getElementById('continue-review');
        const redoBtn = document.getElementById('redo-review');
        const endBtn = document.getElementById('end-review');
        if (continueBtn) continueBtn.addEventListener('click', () => { playClickSound(); continueReview(); });
        if (redoBtn) redoBtn.addEventListener('click', () => { playClickSound(); redoReview(); });
        if (endBtn) endBtn.addEventListener('click', () => { playClickSound(); void endReview(); });

        if (answerInput) {
            const imeState = setupImeHandling(answerInput);

            setupEnterSubmission(answerInput, imeState, () => {
                if (reviewShowAnswerCalled) {
                    reviewNextQuestion();
                } else {
                    reviewCheckAnswer().catch(() => {});
                }
            });
        }

        // 复习模式全局快捷键（只绑定一次）
        reviewShortcutsRemove = setupGlobalShortcuts(
            '#review-quiz-container',
            'review-answer',
            () => reviewShowAnswer(),
            (word) => playPronunciation(appState.settings.pronunciationType, word),
            () => reviewWords[reviewIndex]?.word
        ).remove;

        // Esc 全局快捷键（只绑定一次）
        reviewEscHandler = function(e: KeyboardEvent) {
            if (e.key !== 'Escape') return;
            const answerArea = document.getElementById('review-answer-area');
            const resultEl = document.getElementById('review-result');
            if (resultEl && resultEl.style.display !== 'none') return;
            if (!answerArea || answerArea.style.display === 'none') return;
            if (document.activeElement && document.activeElement.closest('#review-settings-area')) return;
            e.preventDefault();
            e.stopPropagation();
            void endReview();
        };
        document.addEventListener('keydown', reviewEscHandler);

        reviewQuizInitialized = true;
    }

    updateSettingsButtons('review');
}

async function selectReviewWords(source: string, count: number): Promise<ReviewWord[]> {
    let candidates: ReviewWord[] = [];

    const safeParse = (key: string): Record<string, any> => {
        try { return JSON.parse(localStorage.getItem(key) || '{}'); } catch (e) { console.error('解析学习历史失败:', e); return {}; }
    };

    const createReviewWord = (word: string): ReviewWord => ({
        word,
        phonetic: '',
        meanings: [{ part: '', definition: '' }],
        isSentence: word.includes(' ')
    });

    if (source === 'errorbook') {
        candidates = Object.keys(appState.errorbook).map(createReviewWord);
    } else if (source === 'ebbinghaus') {
        const history = safeParse('learningHistory');
        const now = Date.now();
        candidates = Object.entries(history)
            .filter(([, data]: [string, any]) => data.nextReviewTime && data.nextReviewTime <= now)
            .map(([word]) => createReviewWord(word));
        if (appState.settings.enableEbbinghaus) {
            candidates.sort((a, b) => calculateEbbinghausWeight(b.word) - calculateEbbinghausWeight(a.word));
        }
    } else if (source === 'recent') {
        const history = safeParse('learningHistory');
        candidates = Object.entries(history)
            .sort(([, a]: [string, any], [, b]: [string, any]) => b.lastStudyTime - a.lastStudyTime)
            .map(([word]) => createReviewWord(word));
    } else {
        const history = safeParse('learningHistory');
        const now = Date.now();
        const seen = new Set<string>();
        const weighted: { word: string; weight: number }[] = [];

        Object.keys(appState.errorbook).forEach(w => {
            if (!seen.has(w)) {
                seen.add(w);
                const ec = appState.errorbook[w].errorCount || 1;
                weighted.push({ word: w, weight: 3 + Math.min(ec, 5) });
            }
        });

        Object.entries(history).forEach(([word, data]: [string, any]) => {
            if (!seen.has(word) && data.nextReviewTime && data.nextReviewTime <= now) {
                seen.add(word);
                const overdue = (now - data.nextReviewTime) / (24 * 60 * 60 * 1000);
                weighted.push({ word, weight: 2 + Math.min(overdue / 30, 2) });
            }
        });

        Object.entries(history)
            .sort(([, a]: [string, any], [, b]: [string, any]) => b.lastStudyTime - a.lastStudyTime)
            .slice(0, 50)
            .forEach(([word]) => {
                if (!seen.has(word)) {
                    seen.add(word);
                    weighted.push({ word, weight: 1 });
                }
            });

        weighted.sort((a, b) => b.weight - a.weight);
        candidates = weighted.map(w => createReviewWord(w.word));
    }

    const unique: ReviewWord[] = [];
    const seen = new Set<string>();
    for (const w of candidates) {
        const key = w.word.toLowerCase();
        if (!seen.has(key)) {
            seen.add(key);
            unique.push(w);
        }
    }
    return unique.slice(0, count);
}

async function startReview(): Promise<void> {
    const reviewModeSelect = document.getElementById('review-mode') as HTMLSelectElement;
    const sourceEl = document.getElementById('review-source') as HTMLSelectElement;
    const countEl = document.getElementById('review-count') as HTMLInputElement;
    if (!sourceEl || !countEl) return;
    const source = sourceEl.value;
    const count = parseInt(countEl.value) || 20;

    reviewCurrentMode = (reviewModeSelect ? reviewModeSelect.value : QuizMode.EnToZh) as QuizMode;

    await loadWordbooks();
    loadSettings();

    reviewWords = await selectReviewWords(source, count);
    if (reviewWords.length === 0) {
        void showAlert('没有可复习的单词，请先进行一些练习。');
        return;
    }

    // 批量加载释义（与测验模式相同逻辑）
    const wordsNeedLoad = reviewWords.filter(w => {
        const has = w.meanings && w.meanings.length > 0 && w.meanings[0].definition;
        return !has;
    }).map(w => w.word);

    if (wordsNeedLoad.length > 0) {
        try {
            const resp = await fetch('/api/words/batch', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ words: wordsNeedLoad })
            });
            const result = await resp.json();
            if (result.success && result.data) {
                result.data.forEach((item: { word: string; info?: { meanings?: Array<{ part: string; definition: string }>; translation?: string; phonetic?: string } }) => {
                    const w = reviewWords.find(r => r.word.toLowerCase() === item.word.toLowerCase());
                    if (w && item.info) {
                        if (item.info.meanings) w.meanings = item.info.meanings;
                        else if (item.info.translation) w.meanings = [{ part: '', definition: item.info.translation }];
                        if (item.info.phonetic) w.phonetic = item.info.phonetic;
                    }
                });
            }
        } catch (e) { console.error('批量加载释义失败:', e); }
    }

    reviewIndex = 0;
    reviewCorrect = 0;
    reviewWrong = 0;
    reviewTotal = reviewWords.length;
    reviewActive = true;
    reviewCurrentMeanings = [];

    // 创建 session
    reviewSession = createSession('review', source, reviewWords);
    saveSessionState(reviewSession);
    showReviewAnswerArea();

    const container = document.getElementById('review-quiz-container');
    if (container) container.classList.add('quiz-container-visible');
    const startBtn = document.getElementById('start-review') as HTMLButtonElement;
    if (startBtn) startBtn.disabled = true;

    const progress = document.getElementById('review-progress');
    if (progress) progress.style.display = 'flex';

    updateReviewProgress();
    renderReviewQuestion();
}

function updateReviewProgress(): void {
    const fill = document.getElementById('review-progress-fill');
    const text = document.getElementById('review-progress-text');
    if (fill) fill.style.width = `${(reviewIndex / reviewTotal) * 100}%`;
    if (text) text.textContent = `${reviewIndex}/${reviewTotal}`;
}

async function renderReviewQuestion(): Promise<void> {
    if (reviewIndex >= reviewTotal) {
        finishReview();
        return;
    }

    reviewShowAnswerCalled = false;
    reviewCurrentMeanings = [];
    reviewCurrentErrorCount = 0;
    const word = reviewWords[reviewIndex];
    const questionEl = document.getElementById('review-question');
    const answerInput = document.getElementById('review-answer') as HTMLInputElement;
    const feedback = document.getElementById('review-feedback') as HTMLElement;

    if (feedback) {
        feedback.className = '';
        feedback.textContent = '';
    }
    if (answerInput) {
        answerInput.value = '';
        answerInput.disabled = false;
        answerInput.classList.remove('quiz-answer-hidden');
        if (reviewCurrentMode === QuizMode.EnToZh) {
            answerInput.placeholder = '请输入答案，输入多个中文时用逗号分号或空格隔开，按Enter提交';
        } else {
            answerInput.placeholder = '请输入答案...按Enter提交';
        }
        answerInput.focus();
    }

    const showAnswerBtn = document.getElementById('review-show-answer');
    if (showAnswerBtn) showAnswerBtn.style.display = 'inline-block';

    if (!questionEl) return;

    // 如果没有释义，尝试获取翻译（与测验模式相同）
    const hasMeaning = word.meanings && word.meanings.length > 0 && word.meanings[0].definition;
    if (!hasMeaning) {
        try {
            const resp = await fetch(`/api/search?word=${encodeURIComponent(word.word)}`);
            const data = await resp.json();
            if (data.success && data.data && data.data.translation) {
                word.meanings = [{ part: '', definition: data.data.translation }];
            } else if (data.success && data.data && data.data.meanings) {
                word.meanings = data.data.meanings;
            } else {
                const tResp = await fetch('/api/translate', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ text: word.word }),
                });
                const tData = await tResp.json();
                if (tData.success && tData.translation) {
                    word.meanings = [{ part: '', definition: tData.translation }];
                }
            }
        } catch (e) { console.error('批量加载释义失败:', e); }
    }

    // 释义选择（与测验模式相同逻辑：解析词性标记、按 chineseCount/多词性概率选择）
    let allMeaningOptions: { part: string; definition: string }[] = [];
    if (word.meanings && word.meanings.length > 0) {
        word.meanings.forEach(meaning => {
            // 把字面量换行符转成空格，避免题目显示成 "焦虑\\n"
            const definitionText = normalizeNewlines(meaning.definition)
                .replace(/\n/g, ' ')
                .replace(/\\+\s*$/, '')
                .trim();
            const partMatches = definitionText.match(/([a-z]+\.|\[[^\]]+\])/g) || [];

            if (partMatches.length > 0) {
                let lastIndex = 0;
                partMatches.forEach((partTag, idx) => {
                    const partIndex = definitionText.indexOf(partTag, lastIndex);
                    const nextPartIndex = idx < partMatches.length - 1
                        ? definitionText.indexOf(partMatches[idx + 1], partIndex + partTag.length)
                        : definitionText.length;
                    const partDefinition = definitionText.substring(partIndex + partTag.length, nextPartIndex).trim();
                    let cleanPartTag = partTag;
                    if (partTag.endsWith('.')) cleanPartTag = partTag.replace('.', '');
                    const subGroups = partDefinition.split(/[；;]/).map(g => g.trim()).filter(g => g);
                    subGroups.forEach(group => {
                        const singleDefs = group.split(/[，,]/).map(d => d.trim()).filter(d => d);
                        singleDefs.forEach(def => allMeaningOptions.push({ part: cleanPartTag, definition: def }));
                    });
                    lastIndex = nextPartIndex;
                });
            } else {
                const mainGroups = definitionText.split(/[；;]/).map(g => g.trim()).filter(g => g);
                mainGroups.forEach(group => {
                    const singleDefs = group.split(/[，,]/).map(d => d.trim()).filter(d => d);
                    let cleanPart = meaning.part || '';
                    if (cleanPart.endsWith('.')) cleanPart = cleanPart.replace('.', '');
                    singleDefs.forEach(def => allMeaningOptions.push({ part: cleanPart, definition: def }));
                });
            }
        });
    }

    if (!appState.settings.showAllMeanings) {
        allMeaningOptions = allMeaningOptions.filter(item => {
            const isDomainTag = item.part && item.part.startsWith('[');
            return !isDomainTag;
        });
    }

    // 基于权重选择释义（与测验模式相同）
    const selectedMeanings: { part: string; definition: string }[] = [];
    const selectedCount = appState.settings.showAllMeanings
        ? allMeaningOptions.length
        : Math.min(appState.settings.chineseCount, allMeaningOptions.length);

    if (selectedCount > 0) {
        let meaningWeights: Record<string, { errorCount: number; correctCount: number; weight?: number }> | null = null;
        if (appState.errorbook[word.word] && appState.errorbook[word.word].meaningWeights) {
            meaningWeights = appState.errorbook[word.word].meaningWeights;
        }

        const partGroups: Record<string, { part: string; definition: string }[]> = {};
        allMeaningOptions.forEach(item => {
            const key = item.part || '';
            if (!partGroups[key]) partGroups[key] = [];
            partGroups[key].push(item);
        });

        const selectByWeight = (meanings: { part: string; definition: string }[]) => {
            if (!meaningWeights) {
                return meanings[Math.floor(Math.random() * meanings.length)];
            }
            let totalWeight = 0;
            const weighted = meanings.map(m => {
                const w = meaningWeights[m.definition] ? meaningWeights[m.definition].weight : 1;
                totalWeight += w;
                return { item: m, weight: w };
            });
            let r = Math.random() * totalWeight;
            for (const wi of weighted) {
                r -= wi.weight;
                if (r <= 0) return wi.item;
            }
            return meanings[0];
        };

        const uniqueParts = Object.keys(partGroups);
        const random = Math.random() * 100;

        if (uniqueParts.length > 1 && random < (appState.settings.quizMultiPartProbability || 50)) {
            const availableParts = [...uniqueParts];
            while (selectedMeanings.length < selectedCount && availableParts.length > 0) {
                const partIndex = Math.floor(Math.random() * availableParts.length);
                const selectedPart = availableParts[partIndex];
                const partMeanings = partGroups[selectedPart];
                if (partMeanings.length > 0) {
                    const selectedItem = selectByWeight(partMeanings);
                    selectedMeanings.push(selectedItem);
                    const idx = partMeanings.indexOf(selectedItem);
                    if (idx > -1) partMeanings.splice(idx, 1);
                    if (partMeanings.length === 0) availableParts.splice(partIndex, 1);
                }
            }
            if (selectedMeanings.length < selectedCount) {
                const remaining = Object.values(partGroups).flat();
                while (selectedMeanings.length < selectedCount && remaining.length > 0) {
                    const selectedItem = selectByWeight(remaining);
                    selectedMeanings.push(selectedItem);
                    const idx = remaining.indexOf(selectedItem);
                    if (idx > -1) remaining.splice(idx, 1);
                }
            }
        } else {
            let bestPart = '', maxMeanings = 0;
            for (const [part, meanings] of Object.entries(partGroups)) {
                if (meanings.length > maxMeanings) { maxMeanings = meanings.length; bestPart = part; }
            }
            const bestMeanings = partGroups[bestPart];
            while (selectedMeanings.length < selectedCount && bestMeanings.length > 0) {
                const selectedItem = selectByWeight(bestMeanings);
                selectedMeanings.push(selectedItem);
                const idx = bestMeanings.indexOf(selectedItem);
                if (idx > -1) bestMeanings.splice(idx, 1);
            }
            if (selectedMeanings.length < selectedCount) {
                const otherParts = uniqueParts.filter(p => p !== bestPart);
                const otherMeanings = otherParts.flatMap(p => partGroups[p]);
                while (selectedMeanings.length < selectedCount && otherMeanings.length > 0) {
                    const selectedItem = selectByWeight(otherMeanings);
                    selectedMeanings.push(selectedItem);
                    const idx = otherMeanings.indexOf(selectedItem);
                    if (idx > -1) otherMeanings.splice(idx, 1);
                }
            }
        }
    }

    reviewCurrentMeanings = [...selectedMeanings];

    const pronunciationKey = appState.settings.playPronunciationKey || '2';
    const speakerHtml = `<span class="quiz-speak-btn" title="播放发音（快捷键 ${pronunciationKey}）" onclick="g('playPronunciation', '${appState.settings.pronunciationType}', '${escapeForJsString(word.word)}')">🔊</span>`;

    if (reviewCurrentMode === QuizMode.Dictation) {
        questionEl.innerHTML = `
            <p><strong>听写模式：</strong></p>
            <p style="margin-top: 10px;">请听发音并写出单词</p>
            <button class="quiz-play-btn" onclick="g('playPronunciation', '${appState.settings.pronunciationType}', '${escapeForJsString(word.word)}')">🔊 播放发音</button>
        `;
        setTimeout(() => playPronunciation(appState.settings.pronunciationType, word.word), 500);
    } else if (reviewCurrentMode === QuizMode.ZhToEn) {
        let meaningsHtml = '';
        let lastPart: string | null = null;
        selectedMeanings.forEach((item, idx) => {
            if (idx > 0) meaningsHtml += ' ';
            if (item.part && item.part !== lastPart) {
                if (item.part.startsWith('[')) {
                    meaningsHtml += `<span class="quiz-meaning-part">${item.part}</span>`;
                } else {
                    meaningsHtml += `<span class="quiz-meaning-part">${item.part}.</span>`;
                }
                lastPart = item.part;
            }
            meaningsHtml += `<span>${item.definition}</span>`;
        });
        questionEl.innerHTML = `<p><strong>请写出对应的英文单词：</strong></p><p class="quiz-zh-to-en-meanings">${meaningsHtml}${speakerHtml}</p>`;
    } else {
        const displayWord = normalizeCaseByType(word.word);
        let questionHtml = `<p><strong>请写出对应的中文意思：</strong></p><p class="quiz-question-word">${displayWord}${speakerHtml}</p>`;
        if (word.phonetic) {
            questionHtml += `<p class="quiz-question-phonetic">/${word.phonetic}/</p>`;
        }
        questionEl.innerHTML = questionHtml;
    }

    updateReviewProgress();
}

async function reviewCheckAnswer(): Promise<void> {
    if (!reviewActive) return;
    const answer = (document.getElementById('review-answer') as HTMLInputElement).value.trim();
    const feedback = document.getElementById('review-feedback') as HTMLElement;
    const word = reviewWords[reviewIndex];
    const isSentence = word.word.includes(' ') || word.isSentence;

    if (!answer) {
        if (feedback) { feedback.textContent = '请输入答案'; feedback.className = 'quiz-feedback-partial'; }
        return;
    }

    let isCorrect = false;
    let isPartial = false;

    if (reviewCurrentMode === QuizMode.ZhToEn || reviewCurrentMode === QuizMode.Dictation) {
        if (isSentence) {
            const normalize = (s: string) => s.toLowerCase().replace(/[.,!?;:'"]/g, '').trim();
            isCorrect = normalize(answer) === normalize(word.word);
        } else {
            isCorrect = answer.toLowerCase() === word.word.toLowerCase();
        }
    } else {
        if (isSentence) {
            if (word.meanings && word.meanings.length > 0 && word.meanings[0].definition) {
                const checkText = word.meanings[0].definition.substring(0, Math.min(5, word.meanings[0].definition.length));
                isCorrect = answer.includes(checkText);
            }
        } else {
            const allCorrect: string[] = [];
            word.meanings.forEach(m => {
                const parts = m.definition.split(/[；;，,]/).map(p => p.trim()).filter(p => p.length > 0);
                parts.forEach(p => allCorrect.push(p));
            });
            const userAnswers = answer.split(/[，,；;\s]+/).map(a => a.trim()).filter(a => a.length > 0);
            if (userAnswers.length === 0) {
                if (feedback) { feedback.textContent = '请输入答案'; feedback.className = 'quiz-feedback-partial'; }
                return;
            }
            const correctUserAnswers: string[] = [];
            userAnswers.forEach(ua => {
                const match = allCorrect.some(cm => cm.includes(ua) || ua.includes(cm));
                if (match) correctUserAnswers.push(ua);
            });
            if (correctUserAnswers.length === userAnswers.length) {
                isCorrect = true;
            } else if (correctUserAnswers.length > 0) {
                isPartial = true;
            } else {
                // 字符串匹配全部失败，尝试语义相似度兜底
                try {
                    const response = await fetch('/api/semantic-similarity', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ text1: answer, text2: allCorrect.join('，') }),
                    });
                    const result = await response.json();
                    if (result.success && result.data?.isSimilar) {
                        isCorrect = true;
                    }
                } catch {
                    // 模型不可用，保持原有判断
                }
            }
        }
    }

    const answerInput = document.getElementById('review-answer') as HTMLInputElement;

    if (isCorrect) {
        reviewCorrect++;
        if (feedback) { feedback.textContent = '回答正确！'; feedback.className = 'quiz-feedback-success'; animateCorrectFeedback(feedback); playCorrectSound(); }
        if (!isSentence) playPronunciation(appState.settings.pronunciationType, word.word);

        // 错题本 + 释义权重更新（与测验模式相同）
        if (appState.errorbook[word.word]) {
            appState.errorbook[word.word].correctCount++;
            if (reviewCurrentMode !== QuizMode.Dictation && reviewCurrentMeanings.length > 0) {
                if (!appState.errorbook[word.word].meaningWeights) appState.errorbook[word.word].meaningWeights = {};
                reviewCurrentMeanings.forEach(meaning => {
                    if (!appState.errorbook[word.word].meaningWeights[meaning.definition]) {
                        appState.errorbook[word.word].meaningWeights[meaning.definition] = { weight: 1, errorCount: 0, correctCount: 0 };
                    }
                    appState.errorbook[word.word].meaningWeights[meaning.definition].correctCount++;
                    appState.errorbook[word.word].meaningWeights[meaning.definition].weight = Math.max(0.1, appState.errorbook[word.word].meaningWeights[meaning.definition].weight * 0.9);
                });
            }
            if (appState.errorbook[word.word].correctCount >= appState.settings.errorCorrectCount) {
                delete appState.errorbook[word.word];
            }
            localStorage.setItem('errorbook', JSON.stringify(appState.errorbook));
            initErrorbookVue();
        }

        if (answerInput) answerInput.value = '';
        recordLearningHistory(word.word, true);
        appState.studyStats.todayWords++;
        appState.studyStats.learnedCount++;
        updateStudyStats();
        if (reviewSession) markAnswered(reviewSession, word.word, true);
        setTimeout(() => reviewShowAnswer(), 500);
    } else if (isPartial) {
        if (feedback) { feedback.textContent = '对了一部分哦，再检查检查'; feedback.className = 'quiz-feedback-partial'; }
    } else {
        reviewWrong++;
        reviewCurrentErrorCount++;
        if (feedback) { feedback.textContent = '拼写错误，请检查拼写'; feedback.className = 'quiz-feedback-error'; animateErrorShake(feedback); playWrongSound(); }

        if (!appState.errorbook[word.word]) {
            appState.errorbook[word.word] = { errorCount: 1, correctCount: 0, addedTime: Date.now(), meaningWeights: {} };
        } else {
            appState.errorbook[word.word].errorCount++;
            if (!appState.errorbook[word.word].addedTime) appState.errorbook[word.word].addedTime = Date.now();
        }
        if (reviewCurrentMode !== QuizMode.Dictation && reviewCurrentMeanings.length > 0) {
            if (!appState.errorbook[word.word].meaningWeights) appState.errorbook[word.word].meaningWeights = {};
            reviewCurrentMeanings.forEach(meaning => {
                if (!appState.errorbook[word.word].meaningWeights[meaning.definition]) {
                    appState.errorbook[word.word].meaningWeights[meaning.definition] = { weight: 1, errorCount: 0, correctCount: 0 };
                }
                appState.errorbook[word.word].meaningWeights[meaning.definition].errorCount++;
                appState.errorbook[word.word].meaningWeights[meaning.definition].weight *= 1.1;
            });
        }
        localStorage.setItem('errorbook', JSON.stringify(appState.errorbook));
        initErrorbookVue();
        recordLearningHistory(word.word, false);
        appState.studyStats.todayWords++;
        appState.studyStats.learnedCount++;
        updateStudyStats();
        if (reviewSession) markAnswered(reviewSession, word.word, false);

        const autoPlayThreshold = Number(appState.settings.autoPlayPronunciationAfterErrors) || 0;
        if (autoPlayThreshold > 0 && reviewCurrentErrorCount >= autoPlayThreshold && !isSentence) {
            playPronunciation(appState.settings.pronunciationType, word.word);
        }
    }
}

function reviewShowAnswer(): void {
    reviewShowAnswerCalled = true;
    const questionEl = document.getElementById('review-question');
    const word = reviewWords[reviewIndex];
    const isSentence = word.word.includes(' ') || word.isSentence;

    if (!questionEl) return;

    let html = `<p><strong>正确答案：</strong></p>`;
    const displayWord = normalizeCaseByType(word.word);
    html += `<p class="quiz-answer-word">${displayWord}</p>`;
    if (!isSentence && word.phonetic) {
        html += `<p class="quiz-answer-phonetic">/${word.phonetic}/</p>`;
    }

    if (isSentence) {
        if (word.meanings && word.meanings.length > 0 && word.meanings[0].definition) {
            html += `<div style="margin-top:10px;"><strong>翻译：</strong> ${formatDefinitionHtml(word.meanings[0].definition)}</div>`;
        }
    } else {
        html += `<div style="margin-top:10px;"><strong>释义：</strong></div>`;
        word.meanings.forEach(m => {
            html += `<div class="quiz-answer-meaning-row">`;
            if (m.part) html += `<span class="quiz-answer-meaning-part">${m.part}</span>`;
            html += `<span>${formatDefinitionHtml(m.definition)}</span></div>`;
        });
    }

    questionEl.innerHTML = html;

    const answerInput = document.getElementById('review-answer') as HTMLInputElement;
    if (answerInput) {
        answerInput.value = '';
        answerInput.disabled = false;
        answerInput.placeholder = '按Enter进入下一题';
        answerInput.focus();
    }
}

function reviewNextQuestion(): void {
    reviewIndex++;
    if (reviewIndex >= reviewTotal) {
        finishReview();
        return;
    }
    renderReviewQuestion();
}

function finishReview(): void {
    reviewActive = false;
    if (reviewSession) endSessionComplete(reviewSession);
    // 清理可能残留的结果快捷键
    hideReviewResult();

    const container = document.getElementById('review-quiz-container');
    if (container) container.classList.remove('quiz-container-visible');
    const progress = document.getElementById('review-progress');
    if (progress) progress.style.display = 'none';
    const startBtn = document.getElementById('start-review') as HTMLButtonElement;
    if (startBtn) startBtn.disabled = false;

    const result = document.getElementById('review-result');
    if (!result) return;
    result.style.display = 'block';
    playCompleteSound();
    const total = reviewSession ? reviewSession.words.length : reviewTotal;
    const correct = reviewSession ? reviewSession.correctCount : reviewCorrect;
    const wrong = reviewSession ? reviewSession.wrongCount : reviewWrong;
    const accuracy = total > 0 ? Math.round((correct / total) * 100) : 0;
    result.innerHTML = `
        <div class="quiz-result-card">
            <h3>复习完成！</h3>
            <div class="review-stat-row">总题数：<span class="review-stat-val">${total}</span></div>
            <div class="review-stat-row">答对：<span class="review-stat-val">${correct}</span></div>
            <div class="review-stat-row">答错：<span class="review-stat-val">${wrong}</span></div>
            <div class="review-stat-row">正确率：<span class="review-stat-val">${accuracy}%</span></div>
            <div class="quiz-result-actions">
                <button id="review-retry" class="btn-gradient btn-green">重新复习</button>
                <button id="review-next-round" class="btn-gradient btn-blue">开始下一轮</button>
                <button id="review-finish" class="btn-gradient btn-red">结束复习</button>
            </div>
            <div class="quiz-result-hints">
                <span>按 空格键 重新复习</span>
                <span>按 Enter 键 开始下一轮复习</span>
                <span>按 Esc 键 结束复习</span>
            </div>
        </div>
    `;

    const retryBtn = document.getElementById('review-retry');
    const nextRoundBtn = document.getElementById('review-next-round');
    const finishBtn = document.getElementById('review-finish');
    if (retryBtn) retryBtn.addEventListener('click', () => retryReview());
    if (nextRoundBtn) nextRoundBtn.addEventListener('click', () => startNextReviewRound());
    if (finishBtn) finishBtn.addEventListener('click', () => void endReview());

    const handler = (e: KeyboardEvent) => {
        const resultEl = document.getElementById('review-result');
        if (!resultEl || resultEl.style.display === 'none') return;
        if (e.key === ' ') {
            e.preventDefault();
            retryReview();
        } else if (e.key === 'Enter') {
            e.preventDefault();
            startNextReviewRound();
        } else if (e.key === 'Escape') {
            e.preventDefault();
            reviewSession = null;
            showReviewSettingsArea();
        }
    };
    document.addEventListener('keydown', handler, { once: false });
    (result as any)._keyHandler = handler;

    showLearningHistory();
    updateStudyStats();
}

function hideReviewResult(): void {
    const result = document.getElementById('review-result');
    if (result) {
        result.style.display = 'none';
        const handler = (result as any)._keyHandler;
        if (handler) {
            document.removeEventListener('keydown', handler);
            (result as any)._keyHandler = null;
        }
    }
}

// 结束复习（中途退出）
async function endReview(): Promise<void> {
    if (!reviewSession || reviewIndex >= reviewTotal) {
        showReviewSettingsArea();
        return;
    }
    const save = await showConfirm(
        '是否保存本轮复习进度？\n\n选"是"保存进度，选"否"放弃本轮复习记录',
        '结束复习'
    );
    if (save) {
        endSessionWithSave(reviewSession);
    } else {
        endSessionWithRollback(reviewSession);
        // 回退后刷新单词来源统计
        await updateWordSourceSelect();
    }
    reviewSession = null;
    reviewActive = false;
    showReviewSettingsArea();
}

// 继续上一轮复习
async function continueReview(): Promise<void> {
    const state = loadSessionState();
    if (!state) return;
    reviewSession = state;
    reviewWords = state.words as ReviewWord[];
    reviewIndex = state.currentIndex;
    reviewTotal = state.words.length;
    reviewCorrect = state.correctCount;
    reviewWrong = state.wrongCount;
    reviewActive = true;
    reviewCurrentMode = (document.getElementById('review-mode') as HTMLSelectElement)?.value as QuizMode || QuizMode.EnToZh;
    showReviewAnswerArea();
    const container = document.getElementById('review-quiz-container');
    if (container) container.classList.add('quiz-container-visible');
    const progress = document.getElementById('review-progress');
    if (progress) progress.style.display = 'flex';
    updateReviewProgress();
    renderReviewQuestion();
}

// 重新开始上一轮复习
async function redoReview(): Promise<void> {
    const state = loadSessionState();
    if (!state) return;
    reviewSession = createSession('review', state.source, state.words);
    saveSessionState(reviewSession);
    reviewWords = [...state.words] as ReviewWord[];
    reviewIndex = 0;
    reviewCorrect = 0;
    reviewWrong = 0;
    reviewTotal = state.words.length;
    reviewActive = true;
    reviewCurrentMode = (document.getElementById('review-mode') as HTMLSelectElement)?.value as QuizMode || QuizMode.EnToZh;
    showReviewAnswerArea();
    const container = document.getElementById('review-quiz-container');
    if (container) container.classList.add('quiz-container-visible');
    const progress = document.getElementById('review-progress');
    if (progress) progress.style.display = 'flex';
    updateReviewProgress();
    renderReviewQuestion();
}

// 重新复习（同一单词列表）
async function retryReview(): Promise<void> {
    const state = reviewSession;
    if (!state) return;
    clearSessionState();
    reviewSession = createSession('review', state.source, state.words);
    saveSessionState(reviewSession);
    reviewWords = [...state.words] as ReviewWord[];
    reviewIndex = 0;
    reviewCorrect = 0;
    reviewWrong = 0;
    reviewTotal = state.words.length;
    reviewActive = true;
    hideReviewResult();
    const container = document.getElementById('review-quiz-container');
    if (container) container.classList.add('quiz-container-visible');
    const progress = document.getElementById('review-progress');
    if (progress) progress.style.display = 'flex';
    updateReviewProgress();
    renderReviewQuestion();
}

// 开始下一轮复习
async function startNextReviewRound(): Promise<void> {
    hideReviewResult();
    clearSessionState();
    await startReview();
}
