// 测验和复习模式共享的释义选择 & 答案检查逻辑

import { QuizMode } from '../types/enums';
import { normalizeNewlines } from './translation';
import { appState } from '../store';

export interface MeaningItem {
  part: string;
  definition: string;
}

export interface WordData {
  word: string;
  phonetic?: string;
  meanings: MeaningItem[];
  isSentence?: boolean;
}

export interface SelectMeaningsResult {
  meanings: MeaningItem[];
  displayText: string;
}

export interface CheckAnswerResult {
  isCorrect: boolean;
  isPartial: boolean;
}

// 常见词性标签白名单；不在此列表的标记（如 na.）直接忽略，避免显示成奇怪前缀
const VALID_POS_TAGS = new Set([
  'n', 'v', 'adj', 'adv', 'vt', 'vi', 'prep', 'conj', 'pron', 'art', 'num', 'int', 'aux',
  'a', 's', 'r', 'c', 'u',
  'pl', 'sing', 'abbr'
]);

function cleanTailBackslash(text: string): string {
  return text.replace(/\\+\s*$/, '').trim();
}

// 从释义中解析所有单个释义选项（拆分词性标记、分号、逗号）
function parseMeaningOptions(wordMeanings: MeaningItem[]): MeaningItem[] {
  const allOptions: MeaningItem[] = [];

  wordMeanings.forEach(meaning => {
    // CSV 导入的 translation 字段把换行符存成了字面量，先统一归一化
    const definitionText = normalizeNewlines(meaning.definition);
    // 匹配词性标记（如 n., vt.）和领域标记（如 [化], [医]）
    const partMatches = definitionText.match(/([a-z]+\.|\[[^\]]+\])/g) || [];

    if (partMatches.length > 0) {
      let lastIndex = 0;
      partMatches.forEach((partTag, idx) => {
        const partIndex = definitionText.indexOf(partTag, lastIndex);
        const nextPartIndex = idx < partMatches.length - 1
          ? definitionText.indexOf(partMatches[idx + 1], partIndex + partTag.length)
          : definitionText.length;

        const partDefinition = definitionText.substring(partIndex + partTag.length, nextPartIndex).trim();
        let cleanPartTag = '';

        if (partTag.startsWith('[')) {
          // 领域标签保持原样，让上层按"显示全部释义"设置过滤
          cleanPartTag = partTag;
        } else if (partTag.endsWith('.')) {
          // 标准词性保留，非标准词性（如 na.）置空
          const tagWithoutDot = partTag.replace('.', '');
          cleanPartTag = VALID_POS_TAGS.has(tagWithoutDot.toLowerCase()) ? tagWithoutDot : '';
        }

        const subGroups = partDefinition.split(/[；;]/).map(g => g.trim()).filter(g => g);
        subGroups.forEach(group => {
          const singleDefs = group.split(/[，,]/).map(d => cleanTailBackslash(d).trim()).filter(d => d);
          singleDefs.forEach(def => allOptions.push({ part: cleanPartTag, definition: def }));
        });

        lastIndex = nextPartIndex;
      });
    } else {
      const mainGroups = definitionText.split(/[；;]/).map(g => g.trim()).filter(g => g);
      mainGroups.forEach(group => {
        const singleDefs = group.split(/[，,]/).map(d => cleanTailBackslash(d).trim()).filter(d => d);
        let cleanPart = meaning.part || '';
        if (cleanPart.endsWith('.')) cleanPart = cleanPart.replace('.', '');
        if (cleanPart && !VALID_POS_TAGS.has(cleanPart.toLowerCase())) {
          cleanPart = '';
        }
        singleDefs.forEach(def => allOptions.push({ part: cleanPart, definition: def }));
      });
    }
  });

  return allOptions;
}

// 选择题目的释义：解析、过滤、按权重/词性选择
export function selectMeaningsForQuestion(
  wordMeanings: MeaningItem[],
  word: string,
  settings: {
    showAllMeanings: boolean;
    chineseCount: number;
    quizMultiPartProbability: number;
  },
  errorbook: Record<string, any>
): SelectMeaningsResult {
  let allOptions = parseMeaningOptions(wordMeanings);

  // 过滤领域标签（如 [化], [医] 等），除非勾选了"显示全部释义"
  if (!settings.showAllMeanings) {
    const filtered = allOptions.filter(item => !(item.part && item.part.startsWith('[')));
    // 过滤后不能为空，否则该题无法作答，回退到全部释义
    allOptions = filtered.length > 0 ? filtered : allOptions;
  }

  const selectedCount = settings.showAllMeanings
    ? allOptions.length
    : Math.min(settings.chineseCount, allOptions.length);

  const selectedMeanings: MeaningItem[] = [];

  if (selectedCount > 0) {
    // 错题本释义权重
    let meaningWeights: Record<string, { errorCount: number; correctCount: number; weight?: number }> | null = null;
    if (errorbook[word] && errorbook[word].meaningWeights) {
      meaningWeights = errorbook[word].meaningWeights;
    }

    const partGroups: Record<string, MeaningItem[]> = {};
    allOptions.forEach(item => {
      const key = item.part || '';
      if (!partGroups[key]) partGroups[key] = [];
      partGroups[key].push(item);
    });

    // 基于权重/随机选择释义
    const selectByWeight = (meanings: MeaningItem[]) => {
      if (!meaningWeights) {
        return meanings[Math.floor(Math.random() * meanings.length)];
      }
      let totalWeight = 0;
      const weightedItems = meanings.map(m => {
        const w = meaningWeights![m.definition] ? meaningWeights![m.definition].weight : 1;
        totalWeight += w;
        return { item: m, weight: w };
      });
      let r = Math.random() * totalWeight;
      for (const wi of weightedItems) {
        r -= wi.weight;
        if (r <= 0) return wi.item;
      }
      return meanings[0];
    };

    const uniqueParts = Object.keys(partGroups);
    const random = Math.random() * 100;

    if (uniqueParts.length > 1 && random < (settings.quizMultiPartProbability || 50)) {
      // 多词性模式：尽量从不同词性中选择
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
      // 不够的话从剩余释义补充
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
      // 单词性模式：从释义最多的词性中选
      let bestPart = '';
      let maxMeanings = 0;
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
      // 不够从其他词性补充
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

  // 构建纯文本显示（用于 ZhToEn 模式展示中文释义）
  let displayText = '';
  let lastPart: string | null = null;
  selectedMeanings.forEach((item, idx) => {
    if (idx > 0) displayText += ' ';
    if (item.part && item.part !== lastPart) {
      if (item.part.startsWith('[')) {
        displayText += item.part;
      } else {
        displayText += item.part + '.';
      }
      lastPart = item.part;
    }
    displayText += item.definition;
  });

  return { meanings: selectedMeanings, displayText };
}

// 构建 ZhToEn 模式下的释义 HTML 展示（带 formatDefinitionHtml 回调）
export function buildMeaningDisplayHtml(
  selectedMeanings: MeaningItem[],
  formatDefinitionHtml: (def: string) => string
): string {
  let html = '';
  let lastPart: string | null = null;
  selectedMeanings.forEach((item, idx) => {
    if (idx > 0) html += ' ';
    if (item.part && item.part !== lastPart) {
      if (item.part.startsWith('[')) {
        html += `<span class="quiz-meaning-part">${item.part}</span>`;
      } else {
        html += `<span class="quiz-meaning-part">${item.part}.</span>`;
      }
      lastPart = item.part;
    }
    html += `<span>${formatDefinitionHtml(item.definition)}</span>`;
  });
  return html;
}

// 核心答案检查：不涉及 UI 更新、错题本、发音等，只判断对错
// EnToZh 模式下，字符串匹配失败后会调用语义相似度 API 做兜底判断
export async function checkQuizAnswer(
  userAnswer: string,
  word: string,
  meanings: MeaningItem[],
  mode: QuizMode,
  isSentence: boolean
): Promise<CheckAnswerResult> {
  let isCorrect = false;
  let isPartial = false;

  if (mode === QuizMode.ZhToEn || mode === QuizMode.Dictation || mode === QuizMode.Spelling || mode === QuizMode.ListeningStuck) {
    if (isSentence) {
      // 同时去除英文和中文标点，避免因标点差异误判
      const normalize = (s: string) => s.toLowerCase().replace(/[.,!?;:'""。，！？；：""'']/g, '').trim();
      isCorrect = normalize(userAnswer) === normalize(word);
    } else {
      isCorrect = userAnswer.toLowerCase() === word.toLowerCase();
    }
  } else {
    // EnToZh 模式
    if (isSentence) {
      // 句子模式：使用字符重叠度判断（比重叠子串更可靠）
      // 当用户答案覆盖正确翻译 50% 以上字符时判定为正确
      if (meanings && meanings.length > 0 && meanings[0].definition) {
        const correctTranslation = meanings[0].definition;
        // 用 Set 去重，避免正确翻译中的重复字符被重复计数（如"啊啊啊啊"用户只输入"啊"会被误判为全覆盖）
        const correctChars = new Set([...correctTranslation]);
        const overlap = [...correctChars].filter((ch: string) => userAnswer.includes(ch)).length;
        const ratio = overlap / Math.max(correctChars.size, 1);
        isCorrect = ratio >= 0.5;
      }
    } else {
      const allCorrectMeanings: string[] = [];
      meanings.forEach(m => {
        const parts = m.definition.split(/[；;，,]/).map(p => p.trim()).filter(p => p.length > 0);
        parts.forEach(p => allCorrectMeanings.push(p));
      });

      const userAnswers = userAnswer.split(/[，,；;\s]+/).map(a => a.trim()).filter(a => a.length > 0);

      if (userAnswers.length === 0) {
        return { isCorrect: false, isPartial: false };
      }

      const correctUserAnswers: string[] = [];
      const wrongUserAnswers: string[] = [];

      userAnswers.forEach(ua => {
        const match = allCorrectMeanings.some(cm => cm.includes(ua) || ua.includes(cm));
        if (match) {
          correctUserAnswers.push(ua);
        } else {
          wrongUserAnswers.push(ua);
        }
      });

      if (correctUserAnswers.length === userAnswers.length) {
        isCorrect = true;
      } else if (correctUserAnswers.length > 0 && wrongUserAnswers.length > 0) {
        isPartial = true;
      } else {
        // 字符串匹配全部失败，尝试语义相似度兜底
        // 仅在用户开启「语义相似度模型」开关时调用，避免不必要的 CPU 占用
        if (appState.settings.semanticSimilarityEnabled !== false) {
          try {
            const response = await fetch('/api/semantic-similarity', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ text1: userAnswer, text2: allCorrectMeanings.join('，') }),
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
  }

  return { isCorrect, isPartial };
}