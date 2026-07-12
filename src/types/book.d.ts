// 单词本/收藏类型定义

type WordbookItem = string | WordData;

interface WordbookData {
  [name: string]: WordbookItem[];
}

interface SystemWordbook {
  id: string;
  name: string;
  tag: string;
}