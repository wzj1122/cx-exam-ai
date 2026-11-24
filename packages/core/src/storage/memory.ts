import type { StorageAdapter } from '../types/transport';

export class MemoryStorage implements StorageAdapter {
  private readonly map = new Map<string, unknown>();

  async get<T>(key: string, fallback: T): Promise<T> {
    return this.map.has(key) ? (this.map.get(key) as T) : fallback;
  }

  async set<T>(key: string, value: T): Promise<void> {
    this.map.set(key, value);
  }

  async remove(key: string): Promise<void> {
    this.map.delete(key);
  }
}
