import type { StorageAdapter } from '@cx/core';

export class ChromeStorageAdapter implements StorageAdapter {
  async get<T>(key: string, fallback: T): Promise<T> {
    try {
      const result = await chrome.storage.local.get(key);
      return result?.[key] === undefined ? fallback : (result[key] as T);
    } catch {
      return fallback;
    }
  }

  async set<T>(key: string, value: T): Promise<void> {
    await chrome.storage.local.set({ [key]: value });
  }

  async remove(key: string): Promise<void> {
    await chrome.storage.local.remove(key);
  }
}
