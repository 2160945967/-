// 后端接口类型定义

interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
}

interface SearchResult {
  word: string;
  phonetic?: string;
  translation?: string;
  meanings?: WordMeaning[];
  tag?: string;
  exchange?: string;
  from_dicts?: string[];
}

interface TranslateResult {
  success: boolean;
  translation?: string;
  cached?: boolean;
  error?: string;
}

interface SystemWordbookInfo {
  id: string;
  name: string;
  count: number;
}

interface SystemWordbookWords {
  words: {
    word: string;
    phonetic?: string;
    translation?: string;
  }[];
}