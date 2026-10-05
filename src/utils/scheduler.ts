// FSRS 调度封装：基于官方 ts-fsrs（纯 TypeScript、本地运行、无需服务器）
// 复用 learningHistory：每个词的 FSRS Card 以可 JSON 序列化形式存在 learningHistory[word].card
// 与固定艾宾浩斯并存，由 settings.scheduler 切换；历史 correctCount/errorCount 不丢弃

import {
    fsrs,
    createEmptyCard,
    generatorParameters,
    forgetting_curve,
    Rating,
    type Card,
    type Grade,
} from 'ts-fsrs';

export type FsrsGrade = 'again' | 'hard' | 'good' | 'easy';

const f = fsrs();
const DEFAULT_PARAMS = generatorParameters();

const GRADE_RATING: Record<FsrsGrade, Grade> = {
    again: Rating.Again,
    hard: Rating.Hard,
    good: Rating.Good,
    easy: Rating.Easy,
};

/** 可 JSON 序列化的 Card（Date 字段已转毫秒时间戳） */
export type SerializedCard = Record<string, unknown>;

/** Card 序列化为纯对象：due / last_review 转毫秒 */
export function serializeCard(card: Card): SerializedCard {
    return {
        ...card,
        due: card.due.getTime(),
        last_review: card.last_review ? card.last_review.getTime() : null,
    };
}

/** 把序列化对象还原为可用 Card（时间戳转回 Date）；无卡则给一张空卡 */
function reviveCard(raw: SerializedCard | undefined, now: number): Card {
    if (!raw) return createEmptyCard(new Date(now));
    return {
        ...raw,
        due: new Date(raw.due as number),
        last_review: raw.last_review ? new Date(raw.last_review as number) : undefined,
    } as Card;
}

export interface FsrsResult {
    card: SerializedCard;
    nextReviewTime: number;
    stability: number;
    difficulty: number;
    state: number;
    scheduledDays: number;
}

/**
 * 纯计算：给定某词已存 Card（序列化，可为空）与本次评分，
 * 返回新 Card（序列化）与下次复习时间。不读写 localStorage。
 */
export function computeFsrs(
    cardRaw: SerializedCard | undefined,
    grade: FsrsGrade,
    now: number = Date.now(),
): FsrsResult {
    const card = reviveCard(cardRaw, now);
    const { card: next } = f.next(card, new Date(now), GRADE_RATING[grade]);
    return {
        card: serializeCard(next),
        nextReviewTime: next.due.getTime(),
        stability: next.stability,
        difficulty: next.difficulty,
        state: next.state as unknown as number,
        scheduledDays: next.scheduled_days,
    };
}

/** 某词当前的可提取度 R（0~1）；无卡返回 null */
export function getCardRetrievability(cardRaw: SerializedCard | undefined, now: number = Date.now()): number | null {
    if (!cardRaw) return null;
    try {
        return f.get_retrievability(reviveCard(cardRaw, now), new Date(now), false) as number;
    } catch {
        return null;
    }
}

/**
 * FSRS 遗忘曲线 R(t | S)：距上次复习 t 天、稳定度 S 时的回忆概率（0~1）
 * 用默认参数（request_retention=0.9）计算，供可视化绘制曲线
 */
export function curveRetention(elapsedDays: number, stability: number): number {
    const r = forgetting_curve(DEFAULT_PARAMS.w, elapsedDays, stability);
    return Math.max(0, Math.min(1, r));
}

/** 单例 FSRS 默认目标记忆率（0~1） */
export const FSRS_TARGET_RETENTION = DEFAULT_PARAMS.request_retention;
