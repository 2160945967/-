import { describe, it, expect } from 'vitest';
import {
    computeFsrs, curveRetention, getCardRetrievability,
} from '../src/utils/scheduler';

const DAY = 86_400_000;

describe('ts-fsrs 调度 computeFsrs', () => {
    it('新词 Again 进入短时学习步骤（约 1 分钟后到期）', () => {
        const now = Date.now();
        const r = computeFsrs(undefined, 'again', now);
        expect(r.nextReviewTime).toBeGreaterThan(now - 1000);
        expect(r.nextReviewTime - now).toBeLessThan(11 * 60 * 1000);
    });

    it('新词 Good 先走学习步骤，再次 Good 毕业后约 1~5 天到期', () => {
        const now = Date.now();
        const r1 = computeFsrs(undefined, 'good', now);
        expect((r1.nextReviewTime - now) / DAY).toBeLessThan(1); // 约 10 分钟学习步骤
        const r2 = computeFsrs(r1.card, 'good', r1.nextReviewTime);
        const days = (r2.nextReviewTime - r1.nextReviewTime) / DAY;
        expect(days).toBeGreaterThanOrEqual(0.9);
        expect(days).toBeLessThanOrEqual(5);
    });

    it('到期连续 Good，复习间隔逐步拉长', () => {
        let card: Record<string, unknown> | undefined;
        let t = Date.now();
        const scheduled: number[] = [];
        for (let i = 0; i < 5; i++) {
            const r = computeFsrs(card, 'good', t);
            card = r.card;
            scheduled.push(r.scheduledDays);
            t = r.nextReviewTime;
        }
        expect(scheduled[4]).toBeGreaterThan(scheduled[0]);
    });

    it('无卡时可提取度为 null', () => {
        expect(getCardRetrievability(undefined)).toBeNull();
    });
});

describe('遗忘曲线 curveRetention', () => {
    it('第 0 天回忆概率为 1', () => {
        expect(curveRetention(0, 3)).toBeCloseTo(1, 5);
    });
    it('随时间单调下降，90 天明显低于 30 天', () => {
        expect(curveRetention(90, 3)).toBeLessThan(curveRetention(30, 3));
        expect(curveRetention(90, 3)).toBeLessThan(0.7);
    });
    it('相同时间下稳定度越高，留存越高', () => {
        expect(curveRetention(30, 8)).toBeGreaterThan(curveRetention(30, 3));
    });
});
