import type { StorageAdapter } from '../types/transport';

export class LocalStorageAdapter implements StorageAdapter {
  async get<T>(key: string, fallback: T): Promise<T> {
    try {
      const raw = window.localStorage.getItem(key);
      return raw == null ? fallback : (JSON.parse(raw) as T);
    } catch {
      return fallback;
    }
  }

  async set<T>(key: string, value: T): Promise<void> {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // storage may be blocked; caller keeps in-memory config
    }
  }

  async remove(key: string): Promise<void> {
    try {
      window.localStorage.removeItem(key);
    } catch {
      // ignore
    }
  }
}
