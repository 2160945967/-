/**
 * Generic LRU (Least Recently Used) cache implementation.
 * Automatically evicts the oldest entries when capacity is exceeded.
 */

export class LRUCache<T> {
  private maxSize: number;
  private cache: Map<string, T>;

  constructor(maxSize: number = 100) {
    this.maxSize = maxSize;
    this.cache = new Map<string, T>();
  }

  get(key: string): T | undefined {
    if (!this.cache.has(key)) return undefined;
    // Map 维护插入顺序，delete+set 把 key 移到末尾 = 标记为最近使用
    const value = this.cache.get(key)!;
    this.cache.delete(key);
    this.cache.set(key, value);
    return value;
  }

  put(key: string, value: T): void {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxSize) {
      // Map keys() 迭代顺序 = 插入顺序，第一个是最久未使用的
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
    this.cache.set(key, value);
  }

  has(key: string): boolean {
    return this.cache.has(key);
  }

  clear(): void {
    this.cache.clear();
  }

  toJSON(): Record<string, T> {
    const obj: Record<string, T> = {};
    for (const [key, value] of this.cache) {
      obj[key] = value;
    }
    return obj;
  }

  get size(): number {
    return this.cache.size;
  }
}