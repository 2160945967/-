// 全局设置类型定义

/// <reference path="./enums.ts" />

interface SettingsData {
  pronunciationType: PronunciationType;
  chineseCount: number;
  showAllMeanings: boolean;
  answerKey: string;
  playPronunciationKey: string;
  addToWordlistKey: string;
  addToFavoritesKey: string;
  addToFavoritesKeyInQuiz: string;
  addToErrorbookAfterShowAnswer: boolean;
  errorCorrectCount: number;
  autoPlayPronunciationAfterErrors: number;
  quizOrder: QuizOrder;
  quizWordCount: number;
  searchHistoryCount: number;
  enableEbbinghaus: boolean;
  quizMultiPartProbability: number;
  quizSinglePartProbability: number;
  dailyWordCount: number;
  quizMode?: QuizMode;
  wordSource?: WordSource;
  quizCount?: number;
  // 语义相似度模型开关：仅在「看英文写中文」(EnToZh) 模式下，当字符串匹配失败时调用本地模型兜底判断
  // 关闭后答错判定完全依赖字符串匹配，可减少 CPU 占用
  semanticSimilarityEnabled: boolean;
}