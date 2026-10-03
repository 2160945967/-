// 模拟题（阅读 / 听力）判分纯逻辑，与 DOM 解耦，便于单元测试。

export interface GradedQuestion {
  /** 题号 */
  n: number;
  /** 正确答案选项，如 'A' */
  a: string;
}

export interface ExamGrade {
  total: number;
  answered: number;
  correct: number;
}

/**
 * 对照答案判分。
 * answers 以题号为键、用户所选选项为值，如 { 1: 'A', 2: 'C' }。
 */
export function gradeQuestions(
  questions: GradedQuestion[],
  answers: Record<number, string>,
): ExamGrade {
  let correct = 0;
  for (const q of questions) {
    if (Object.prototype.hasOwnProperty.call(answers, q.n) && answers[q.n] === q.a) {
      correct++;
    }
  }
  return {
    total: questions.length,
    answered: Object.keys(answers).length,
    correct,
  };
}
