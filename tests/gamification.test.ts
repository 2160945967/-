import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    recordWordLearned, getStreakData, getTodayEntry,
    addStudySeconds, getRecentDailyLog, getDailyLogForMonth,
    getEarliestLogMonth, __resetGamCache,
} from '../src/utils/gamification';

describe('每日记录与连胜', () => {
    beforeEach(() => {
        localStorage.clear();
        __resetGamCache();
        vi.useFakeTimers();
        vi.setSystemTime(new Date(2026, 10, 1, 10, 0, 0));
    });
    afterEach(() => vi.useRealTimers());

    it('当天首次学习：连胜为 1，单词累加', () => {
        const ev = recordWordLearned(1);
        expect(ev.streak.current).toBe(1);
        expect(ev.today.words).toBe(1);
        expect(ev.streakAdvanced).toBe(true);
    });

    it('同一天多次学习不重复推进连胜，单词继续累加', () => {
        recordWordLearned(1);
        const ev2 = recordWordLearned(1);
        expect(ev2.streak.current).toBe(1);
        expect(ev2.streakAdvanced).toBe(false);
        expect(getTodayEntry().words).toBe(2);
    });

    it('连续两天学习，连胜 +1', () => {
        recordWordLearned(1);
        vi.setSystemTime(new Date(2026, 10, 2, 10, 0, 0));
        const ev = recordWordLearned(1);
        expect(ev.streak.current).toBe(2);
        expect(ev.streakAdvanced).toBe(true);
    });

    it('错过一天且无保护卡，断签回到 1', () => {
        recordWordLearned(1);
        vi.setSystemTime(new Date(2026, 10, 3, 10, 0, 0)); // 跳过 11月2日
        const ev = recordWordLearned(1);
        expect(ev.streak.current).toBe(1);
        expect(ev.streakReset).toBe(true);
    });

    it('7 天连胜达成里程碑并奖励 1 张保护卡', () => {
        for (let d = 1; d <= 7; d++) {
            vi.setSystemTime(new Date(2026, 10, d, 10, 0, 0));
            recordWordLearned(1);
        }
        const st = getStreakData();
        expect(st.current).toBe(7);
        expect(st.freezes).toBe(1);
        expect(st.milestones).toContain(7);
        expect(st.best).toBe(7);
    });

    it('错过一天但有保护卡，自动消耗并保住连胜', () => {
        for (let d = 1; d <= 7; d++) {
            vi.setSystemTime(new Date(2026, 10, d, 10, 0, 0));
            recordWordLearned(1); // 7 天后 current=7, freezes=1
        }
        vi.setSystemTime(new Date(2026, 10, 9, 10, 0, 0)); // 跳过 11月8日
        const ev = recordWordLearned(1);
        expect(ev.streak.current).toBe(7);
        expect(ev.streakFrozen).toBe(true);
        expect(ev.streak.freezes).toBe(0);
    });

    it('达到每日单词目标触发 goalJustMet', () => {
        const ev = recordWordLearned(20); // 默认 dailyWordCount=20
        expect(ev.goalJustMet).toBe(true);
        expect(getTodayEntry().goalMet).toBe(true);
    });

    it('学习秒数累加，近 N 天记录补零', () => {
        addStudySeconds(40);
        addStudySeconds(5);
        expect(getTodayEntry().seconds).toBe(45);
        const r = getRecentDailyLog(7);
        expect(r.length).toBe(7);
    });

    it('按月查询：当月截断到今天，历史月返回整月并补零', () => {
        recordWordLearned(3);
        const cur = getDailyLogForMonth(2026, 10);   // 2026 年 11 月
        expect(cur.length).toBe(1);                  // 系统时间为 11 月 1 日
        expect(cur[0].entry.words).toBe(3);
        const prev = getDailyLogForMonth(2026, 9);   // 2026 年 10 月，31 天
        expect(prev.length).toBe(31);
        expect(prev[0].entry.words).toBe(0);         // 补零
    });

    it('最早数据月份：无记录为当前月', () => {
        expect(getEarliestLogMonth()).toEqual({ year: 2026, month: 10 });
        recordWordLearned(1);
        expect(getEarliestLogMonth()).toEqual({ year: 2026, month: 10 });
    });
});
