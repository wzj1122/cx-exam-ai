import type { AppConfig } from '../types';
import type { StorageAdapter } from '../types/transport';
import { DEFAULT_CONFIG, mergeConfig } from './defaults';

const CONFIG_KEY = 'cx-exam-ai:v2:config';
const SYNC_CODE_KEY = 'cx-exam-ai:v2:sync-code';
const SYNC_STATE_KEY = 'cx-exam-ai:v2:sync-state';

export interface SyncState {
  ok: boolean;
  at: number;
  error?: string;
  message?: string;
}

export class ConfigStore {
  private config: AppConfig = structuredClone(DEFAULT_CONFIG);
  private loaded = false;

  constructor(private readonly storage: StorageAdapter) {}

  async load(): Promise<AppConfig> {
    if (this.loaded) return this.config;
    const raw = await this.storage.get<Partial<AppConfig> | null>(CONFIG_KEY, null);
    this.config = mergeConfig(DEFAULT_CONFIG, raw as Partial<AppConfig> | null);
    this.loaded = true;
    return this.config;
  }

  get(): AppConfig {
    return this.config;
  }

  async save(next?: AppConfig): Promise<AppConfig> {
    if (next) this.config = mergeConfig(DEFAULT_CONFIG, next);
    await this.storage.set(CONFIG_KEY, this.config);
    this.loaded = true;
    return this.config;
  }

  async patch(patch: Partial<AppConfig>): Promise<AppConfig> {
    this.config = mergeConfig(this.config, patch);
    return this.save();
  }

  async exportJson(): Promise<string> {
    return JSON.stringify(this.config, null, 2);
  }

  async importJson(text: string): Promise<AppConfig> {
    const parsed = JSON.parse(text) as Partial<AppConfig>;
    return this.save(mergeConfig(DEFAULT_CONFIG, parsed));
  }

  async getSyncCode(): Promise<string> {
    return this.storage.get<string>(SYNC_CODE_KEY, '');
  }

  async setSyncCode(code: string): Promise<void> {
    if (code) await this.storage.set(SYNC_CODE_KEY, code);
    else await this.storage.remove(SYNC_CODE_KEY);
  }

  async getSyncState(): Promise<SyncState | null> {
    return this.storage.get<SyncState | null>(SYNC_STATE_KEY, null);
  }

  async setSyncState(state: SyncState): Promise<void> {
    await this.storage.set(SYNC_STATE_KEY, state);
  }
}
