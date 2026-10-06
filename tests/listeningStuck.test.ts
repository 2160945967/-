import { describe, it, expect, beforeEach } from 'vitest';
import { appState } from '../src/store';
import {
    addListeningStuckWord, isListeningStuck, addListeningStuckWithToast,
} from '../src/utils/listeningStuck';

function clearStuck(): void {
    Object.keys(appState.listeningStuckWords).forEach(k => delete appState.listeningStuckWords[k]);
}

describe('听力卡壳词', () => {
    beforeEach(() => {
        localStorage.clear();
        clearStuck();
    });

    it('新词添加返回 true，stuckCount=1', () => {
        expect(addListeningStuckWord({ word: 'abandon' })).toBe(true);
        const e = appState.listeningStuckWords['abandon'];
        expect(e.word).toBe('abandon');
        expect(e.stuckCount).toBe(1);
        expect(isListeningStuck('abandon')).toBe(true);
    });

    it('重复添加返回 false，stuckCount 累加', () => {
        addListeningStuckWord({ word: 'abandon' });
        expect(addListeningStuckWord({ word: 'abandon' })).toBe(false);
        expect(appState.listeningStuckWords['abandon'].stuckCount).toBe(2);
    });

    it('大小写归一：Apple 与 apple 是同一条目', () => {
        addListeningStuckWord({ word: 'Apple' });
        addListeningStuckWord({ word: 'apple' });
        expect(Object.keys(appState.listeningStuckWords)).toEqual(['apple']);
        expect(appState.listeningStuckWords['apple'].stuckCount).toBe(2);
    });

    it('保留音标与释义', () => {
        addListeningStuckWord({ word: 'apple', phonetic: '/ˈæpl/', meanings: [{ part: 'n.', definition: '苹果' }] });
        const e = appState.listeningStuckWords['apple'];
        expect(e.phonetic).toBe('/ˈæpl/');
        expect(e.meanings?.[0]?.definition).toBe('苹果');
    });

    it('空词返回 false', () => {
        expect(addListeningStuckWord({ word: '  ' })).toBe(false);
    });

    it('带弹幕添加（新词 / 重复）均不抛错', () => {
        expect(() => addListeningStuckWithToast({ word: 'banana' })).not.toThrow();
        expect(() => addListeningStuckWithToast({ word: 'banana' })).not.toThrow();
        expect(appState.listeningStuckWords['banana'].stuckCount).toBe(2);
    });
});
