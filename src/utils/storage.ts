// localStorage wrapper with JSON serialization

// 安全解析 localStorage 中的 JSON：读不到(null)、JSON 损坏、或写入了非 JSON 字符串时
// 一律返回 fallback，绝不抛错导致整页崩溃。
export function safeParse<T = any>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function storageGet<T = any>(key: string, defaultValue?: T): T {
  try {
    const value = localStorage.getItem(key);
    if (value === null) return defaultValue as T;
    return JSON.parse(value) as T;
  } catch {
    return defaultValue as T;
  }
}

export function storageSet(key: string, value: any): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    console.error('storageSet error:', e);
  }
}

export function storageRemove(key: string): void {
  localStorage.removeItem(key);
}

export function storageClear(): void {
  localStorage.clear();
}