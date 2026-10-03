import { describe, it, expect } from 'vitest';
import {
  VALID_WORD, HAS_CHINESE, ENGLISH_ONLY, HTML_TAGS, LEADING_NUMBER,
  COLLAPSE_WHITESPACE, STRIP_CONTROL_CHARS, EMAIL_PATTERN, EXTRACT_FIRST_WORD,
} from '../src/utils/regex';

describe('VALID_WORD', () => {
  it('接受普通单词与连字符/撇号/短语', () => {
    expect(VALID_WORD.test('apple')).toBe(true);
    expect(VALID_WORD.test("apple's")).toBe(true);
    expect(VALID_WORD.test('well-being')).toBe(true);
    expect(VALID_WORD.test('good morning')).toBe(true);
  });
  it('拒绝数字开头与空串', () => {
    expect(VALID_WORD.test('1abc')).toBe(false);
    expect(VALID_WORD.test('')).toBe(false);
  });
});

describe('HAS_CHINESE / ENGLISH_ONLY', () => {
  it('检测中文', () => {
    expect(HAS_CHINESE.test('apple')).toBe(false);
    expect(HAS_CHINESE.test('苹果')).toBe(true);
  });
  it('识别纯英文行', () => {
    expect(ENGLISH_ONLY.test('apple')).toBe(true);
    expect(ENGLISH_ONLY.test('苹果')).toBe(false);
  });
});

describe('EXTRACT_FIRST_WORD', () => {
  it('提取竖线分隔前的单词', () => {
    expect(EXTRACT_FIRST_WORD.exec('apple | x')?.groups?.word).toBe('apple');
  });
  it('无释义时取整个单词', () => {
    expect(EXTRACT_FIRST_WORD.exec('apple')?.groups?.word).toBe('apple');
    expect(EXTRACT_FIRST_WORD.exec("apple's")?.groups?.word).toBe("apple's");
  });
  it('无空格直接跟全角注释不匹配', () => {
    expect(EXTRACT_FIRST_WORD.exec('apple（苹果）')?.groups?.word).toBeUndefined();
  });
});

describe('LEADING_NUMBER', () => {
  it('提取行首序号', () => {
    expect(LEADING_NUMBER.exec('1. hello')?.groups?.num).toBe('1.');
    expect(LEADING_NUMBER.exec('12、x')?.groups?.num).toBe('12、');
    expect(LEADING_NUMBER.exec('3) y')?.groups?.num).toBe('3)');
  });
});

describe('HTML_TAGS', () => {
  it('去除标签保留文本', () => {
    expect('<b>apple</b>'.replace(HTML_TAGS, '')).toBe('apple');
  });
});

describe('COLLAPSE_WHITESPACE / STRIP_CONTROL_CHARS', () => {
  it('压缩连续空白', () => {
    expect('a   b'.replace(COLLAPSE_WHITESPACE, ' ')).toBe('a b');
  });
  it('移除控制字符', () => {
    expect('a\x00b'.replace(STRIP_CONTROL_CHARS, '')).toBe('ab');
  });
});

describe('EMAIL_PATTERN', () => {
  it('提取邮箱', () => {
    expect(EMAIL_PATTERN.exec('contact me at test@example.com please')?.groups?.email).toBe('test@example.com');
  });
});
