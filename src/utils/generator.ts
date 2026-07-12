export function* lazyChunk<T>(items: T[], chunkSize: number = 1): IterableIterator<T[]> {
    for (let i = 0; i < items.length; i += chunkSize) {
        yield items.slice(i, i + chunkSize);
    }
}

export function takeN<T>(gen: IterableIterator<T>, count: number): T[] {
    const result: T[] = [];
    for (let i = 0; i < count; i++) {
        const next = gen.next();
        if (next.done) break;
        result.push(next.value);
    }
    return result;
}

export function* filterGen<T>(gen: IterableIterator<T>, predicate: (item: T) => boolean): IterableIterator<T> {
    for (const item of gen) {
        if (predicate(item)) yield item;
    }
}

export function* mapGen<T, R>(gen: IterableIterator<T>, mapper: (item: T) => R): IterableIterator<R> {
    for (const item of gen) {
        yield mapper(item);
    }
}

export function batchProcess<T>(items: T[], chunkSize: number, onChunk: (chunk: T[], index: number) => void): void {
    const gen = lazyChunk(items, chunkSize);
    let index = 0;
    for (const chunk of gen) {
        onChunk(chunk, index++);
    }
}

export function* lineGen(text: string, skipEmpty: boolean = true): IterableIterator<string> {
    const lines = text.split('\n');
    for (const line of lines) {
        const trimmed = line.trim();
        if (skipEmpty && !trimmed) continue;
        yield trimmed;
    }
}

export function* deduplicate<T>(gen: IterableIterator<T>): IterableIterator<T> {
    const seen = new Set<T>();
    for (const item of gen) {
        if (!seen.has(item)) {
            seen.add(item);
            yield item;
        }
    }
}

export function* limitGen<T>(gen: IterableIterator<T>, maxCount: number): IterableIterator<T> {
    let count = 0;
    for (const item of gen) {
        if (count >= maxCount) return;
        yield item;
        count++;
    }
}
