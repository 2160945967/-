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
  // 答题时显示例句：目标词挖空为下划线，答对后在详细释义中展示完整例句
  showExampleInQuiz: boolean;
  // 中译英/拼写时逐字符辅助着色：正确前缀绿色、从首个错误位起红色
  assistSpelling: boolean;
  // 词书派生词开关：开启后《英语四级·你还在背单词吗》每个主词的派生词作为独立词条一并练习
  includeDerivations: boolean;
}