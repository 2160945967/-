import { describe, it, expect } from 'vitest';
import {
  lazyChunk, takeN, filterGen, mapGen, batchProcess, lineGen, deduplicate, limitGen,
} from '../src/utils/generator';

describe('lazyChunk', () => {
  it('按块大小切片', () => {
    expect([...lazyChunk([1, 2, 3, 4], 2)]).toEqual([[1, 2], [3, 4]]);
  });
  it('末块不足返回剩余', () => {
    expect([...lazyChunk([1, 2, 3, 4, 5], 2)]).toEqual([[1, 2], [3, 4], [5]]);
  });
  it('空数组无产出', () => {
    expect([...lazyChunk([], 2)]).toEqual([]);
  });
});

describe('takeN', () => {
  it('取前 N 个产出', () => {
    expect(takeN(lazyChunk([1, 2, 3], 1), 2)).toEqual([[1], [2]]);
  });
  it('产出不足时全部返回', () => {
    expect(takeN(lazyChunk([1], 1), 3)).toEqual([[1]]);
  });
});

describe('filterGen / mapGen', () => {
  it('按谓词过滤', () => {
    expect([...filterGen(lazyChunk([1, 2, 3, 4], 1), (x) => x[0] % 2 === 0)]).toEqual([[2], [4]]);
  });
  it('按映射转换', () => {
    expect([...mapGen(lazyChunk([1, 2], 1), (x) => x[0] * 10)]).toEqual([10, 20]);
  });
});

describe('lineGen', () => {
  it('拆分并修剪行', () => {
    expect([...lineGen(' a \n b ')]).toEqual(['a', 'b']);
  });
  it('默认跳过空行', () => {
    expect([...lineGen('a\n\n b\n')]).toEqual(['a', 'b']);
  });
  it('保留空行', () => {
    expect([...lineGen('a\n\nb', false)]).toEqual(['a', '', 'b']);
  });
});

describe('deduplicate', () => {
  it('保序去重', () => {
    expect([...deduplicate(lineGen('a\na\nb\na'))]).toEqual(['a', 'b']);
  });
});

describe('limitGen', () => {
  it('限制产出数量', () => {
    expect([...limitGen(lineGen('a\nb\nc'), 2)]).toEqual(['a', 'b']);
  });
});

describe('batchProcess', () => {
  it('逐块回调并带索引', () => {
    const seen: Array<{ chunk: number[]; index: number }> = [];
    batchProcess([1, 2, 3], 2, (chunk, index) => seen.push({ chunk, index }));
    expect(seen).toEqual([
      { chunk: [1, 2], index: 0 },
      { chunk: [3], index: 1 },
    ]);
  });
});
