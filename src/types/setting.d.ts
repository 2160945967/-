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
}