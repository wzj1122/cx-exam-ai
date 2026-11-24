import type { StorageAdapter } from '@cx/core';

function hasGm(): boolean {
  return typeof GM_getValue === 'function' && typeof GM_setValue === 'function';
}

export class GmStorage implements StorageAdapter {
  async get<T>(key: string, fallback: T): Promise<T> {
    try {
      if (hasGm()) {
        const value = GM_getValue<unknown>(key, undefined);
        return value === undefined ? fallback : (value as T);
      }
      const raw = localStorage.getItem(key);
      return raw == null ? fallback : (JSON.parse(raw) as T);
    } catch {
      return fallback;
    }
  }

  async set<T>(key: string, value: T): Promise<void> {
    try {
      if (hasGm()) GM_setValue(key, value);
      else localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // ignore
    }
  }

  async remove(key: string): Promise<void> {
    try {
      if (hasGm()) GM_deleteValue(key);
      else localStorage.removeItem(key);
    } catch {
      // ignore
    }
  }
}
