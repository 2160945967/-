// 单词核心类型定义

interface WordMeaning {
  part: string;
  definition: string;
}

interface WordData {
  word: string;
  phonetic?: string;
  meanings: WordMeaning[];
  tags?: string;
  exchange?: string;
  fromDicts?: string[];
  enhanced?: EnhancedData;
  examples?: ExampleData[];
  isSentence?: boolean;
  ebbinghausWeight?: number;
  type?: string;
  timestamp?: number;
  addedTime?: number;
  errorCount?: number;
  correctCount?: number;
  meaningWeights?: Record<string, { errorCount: number; correctCount: number; weight?: number }>;
  translation?: string;
}

interface EnhancedData {
  roots?: RootInfo[];
  similar_words?: string[];
  resemble_groups?: ResembleGroup[];
}

interface RootInfo {
  root: string;
  info: {
    meaning?: string;
    class?: string;
    example?: string[];
  };
}

interface ResembleGroup {
  explanation: string[];
}

interface ExampleData {
  text: string;
  translation?: string;
  lang: string;
}

interface ApiSearchData {
  word: string;
  phonetic?: string;
  translation?: string;
  tag?: string;
  exchange?: string;
  from_dicts?: string[];
  meanings?: WordMeaning[];
}

interface ApiEnhancedData {
  roots?: RootInfo[];
  similar_words?: string[];
  resemble_groups?: ResembleGroup[];
}

interface ApiBatchData {
  word: string;
  info?: {
    meanings?: WordMeaning[];
    translation?: string;
    phonetic?: string;
  };
}

interface ApiExampleData {
  text: string;
  translation?: string;
  lang: string;
}

interface ApiWordbookListData {
  [name: string]: (string | WordData)[];
}

interface SystemWordbookEntry {
  id: string;
  name: string;
  count: number;
}

interface SystemWordbookWord {
  word: string;
  translation?: string;
}

interface ImportWordbookResult {
  word_count: number;
  phrase_count: number;
  total: number;
  success_count: number;
  duplicated_count: number;
  failed_count: number;
}

// 错题本条目
interface ErrorbookEntry {
  word?: string;
  errorCount: number;
  correctCount: number;
  lastErrorTime?: number;
  lastCorrectTime?: number;
  meaningWeights?: Record<string, { errorCount: number; correctCount: number; weight?: number }>;
  addedTime?: number;
  type?: string;
}

// 收藏条目
interface FavoriteEntry {
  word: string;
  type?: string;
  translation?: string;
  meanings?: WordMeaning[];
  timestamp?: number;
}

// 虚拟滚动列表项
interface WordListItem {
    word: string;
    _idx: number;
    type?: string;
    timestamp?: number;
    translation?: string;
    meanings?: WordMeaning[];
}

// 听力卡壳词条目
interface ListeningStuckWord {
    word: string;
    phonetic?: string;
    meanings?: WordMeaning[];
    stuckCount: number;
    lastStuckTime: number;
}
