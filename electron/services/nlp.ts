// 按词数和句末标点分类：<=1 词为单词，>5 词或含句末标点为句子，否则为短语
export function classifyText(text: string): 'word' | 'phrase' | 'sentence' {
  if (!text || text.trim().length === 0) return 'word';
  const trimmed = text.trim();
  const words = trimmed.split(/\s+/).filter(t => /[a-zA-Z0-9]/.test(t));
  if (words.length <= 1) return 'word';
  if (words.length > 5 || /[.!?;]/.test(trimmed)) return 'sentence';
  return 'phrase';
}

// 按类型规范化首字母大小写：单词/短语小写，句子大写
export function normalizeCaseByType(text: string): string {
  if (!text || text.length === 0) return text;
  const type = classifyText(text);
  if (type === 'sentence') {
    return text.charAt(0).toUpperCase() + text.slice(1);
  }
  return text.charAt(0).toLowerCase() + text.slice(1);
}