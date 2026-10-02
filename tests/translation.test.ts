import { describe, it, expect } from 'vitest';
import { normalizeNewlines, parseMeanings } from '../src/utils/translation';

describe('normalizeNewlines', () => {
  it('统一 CRLF / CR 为 LF', () => {
    expect(normalizeNewlines('a\r\nb\rc')).toBe('a\nb\nc');
  });
  it('undefined 不抛错并返回字符串', () => {
    expect(typeof normalizeNewlines(undefined)).toBe('string');
  });
});

describe('parseMeanings 词性归属', () => {
  const def = 'n. the trait of lacking restraint\nv. forsake, leave behind\nv. give up forever\nv. stop insisting on';

  it('中文合并一行、英文多词性时取主要词性 v.', () => {
    const ms = parseMeanings('丢弃;遗弃,抛弃;放弃', def, { pos: 'n v vt', word: 'abandon' });
    expect(ms.length).toBe(1);
    expect(ms[0].part).toBe('v.');
    expect(ms[0].definition).toContain('丢弃');
  });
  it('中英逐行对应时逐行取词性', () => {
    const ms = parseMeanings('苹果\n香蕉', 'n. apple fruit\nn. banana fruit', { word: 'x' });
    expect(ms[0].part).toBe('n.');
    expect(ms[1].part).toBe('n.');
  });
  it('无英文释义且多词性时不硬贴错误标签', () => {
    const ms = parseMeanings('某释义', '', { pos: 'n v', word: 'abandon' });
    expect(ms[0].part).toBe('');
  });
});
