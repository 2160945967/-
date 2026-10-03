import { describe, it, expect } from 'vitest';
import { gradeQuestions } from '../src/utils/examGrade';

const QS = [
  { n: 1, a: 'A' },
  { n: 2, a: 'B' },
  { n: 3, a: 'C' },
];

describe('gradeQuestions', () => {
  it('全部答对', () => {
    expect(gradeQuestions(QS, { 1: 'A', 2: 'B', 3: 'C' })).toEqual({
      total: 3, answered: 3, correct: 3,
    });
  });
  it('部分错误', () => {
    const r = gradeQuestions(QS, { 1: 'A', 2: 'C', 3: 'C' });
    expect(r.correct).toBe(2);
    expect(r.answered).toBe(3);
  });
  it('有未作答题目', () => {
    const r = gradeQuestions(QS, { 1: 'A' });
    expect(r).toEqual({ total: 3, answered: 1, correct: 1 });
  });
  it('空答案', () => {
    expect(gradeQuestions(QS, {})).toEqual({ total: 3, answered: 0, correct: 0 });
  });
  it('题号越界的作答不计正确', () => {
    const r = gradeQuestions(QS, { 9: 'A' } as any);
    expect(r.correct).toBe(0);
    expect(r.answered).toBe(1);
  });
});
