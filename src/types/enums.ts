// 集中管理所有字符串常量，const enum 编译时内联为字面量

/** 发音类型 */
export const enum PronunciationType {
    US = 'us',
    UK = 'uk',
}

/** 测验模式 */
export const enum QuizMode {
    ZhToEn = 'zh-to-en',
    EnToZh = 'en-to-zh',
    WordMeaning = 'word-meaning',
    Dictation = 'dictation',
    Spelling = 'spelling',
    ListeningStuck = 'listening-stuck',
}

/** 答题顺序 */
export const enum QuizOrder {
    Random = 'random',
    Order = 'order',
}

/** 排序方式 */
export const enum SortBy {
    Alphabetical = 'alphabetical',
    Frequency = 'frequency',
    Time = 'time',
}

/** 筛选类型 */
export const enum FilterType {
    All = 'all',
    Word = 'word',
    Phrase = 'phrase',
    Sentence = 'sentence',
}

/** 单词来源（系统/自建单词本选择器） */
export const enum WordSource {
    Favorites = 'favorites',
    /** 自建单词本通过动态名称访问，此值仅作兜底 */
    Wordbook = 'wordbook',
    Errorbook = 'errorbook',
}

/** 页面区段 */
export const enum PageSection {
    Dictionary = 'dictionary',
    Quiz = 'quiz',
    Wordbook = 'wordbook',
    Favorites = 'favorites',
    Errorbook = 'errorbook',
    Review = 'review',
    Settings = 'settings',
    Exam = 'exam',
}

/** 单词内容分类 */
export const enum ContentType {
    Word = 'word',
    Phrase = 'phrase',
    Sentence = 'sentence',
}
