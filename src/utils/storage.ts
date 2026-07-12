// localStorage wrapper with JSON serialization
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