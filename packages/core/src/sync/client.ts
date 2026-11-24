import type { AppConfig } from '../types';
import type { HttpTransport } from '../types/transport';
import { DEFAULT_CONFIG, LEGACY_SYNC_API, mergeConfig } from '../config/defaults';
import { createSyncCode, decryptText, encryptText, parseSyncCode, writeToken } from './crypto';
import { migrateLegacyConfig } from './migrate';

export interface SyncPullResult {
  config: AppConfig;
  at: number;
  code: string;
}

export class SyncClient {
  constructor(
    private readonly transport: HttpTransport,
    private readonly apiBase = DEFAULT_CONFIG.sync.apiBase,
  ) {}

  private base(): string {
    return String(this.apiBase || DEFAULT_CONFIG.sync.apiBase).replace(/\/+$/, '');
  }

  async createAndPush(config: AppConfig): Promise<{ code: string; at: number }> {
    const code = createSyncCode();
    const result = await this.pushWithCode(code.code, config);
    return { code: code.code, at: result.at };
  }

  async pushWithCode(codeText: string, config: AppConfig): Promise<{ at: number }> {
    const code = parseSyncCode(codeText);
    const blob = await encryptText(code.keyRaw, JSON.stringify(config));
    const token = await writeToken(code.keyRaw);
    const response = await this.transport.request({
      method: 'PUT',
      url: `${this.base()}/${encodeURIComponent(code.id)}`,
      headers: {
        'content-type': 'application/json',
        'x-cxai-token': token,
      },
      body: JSON.stringify({ blob }),
      timeoutMs: 15_000,
    });
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`上传配置失败：HTTP ${response.status} ${response.bodyText.slice(0, 200)}`);
    }
    const data = JSON.parse(response.bodyText || '{}');
    return { at: Number(data.at) || Date.now() };
  }

  async pull(codeText: string): Promise<SyncPullResult> {
    const code = parseSyncCode(codeText);
    const response = await this.transport.request({
      method: 'GET',
      url: `${this.base()}/${encodeURIComponent(code.id)}`,
      headers: { accept: 'application/json' },
      timeoutMs: 15_000,
    });
    if (response.status === 404) throw new Error('同步码不存在或已过期');
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`拉取配置失败：HTTP ${response.status}`);
    }
    const data = JSON.parse(response.bodyText || '{}');
    if (!data.blob) throw new Error('同步数据为空');
    const plain = await decryptText(code.keyRaw, String(data.blob));
    const parsed = JSON.parse(plain) as AppConfig;
    return { config: mergeConfig(DEFAULT_CONFIG, parsed), at: Number(data.at) || Date.now(), code: codeText };
  }

  async remove(codeText: string): Promise<void> {
    const code = parseSyncCode(codeText);
    const token = await writeToken(code.keyRaw);
    await this.transport.request({
      method: 'DELETE',
      url: `${this.base()}/${encodeURIComponent(code.id)}`,
      headers: { 'x-cxai-token': token },
      timeoutMs: 15_000,
    });
  }

  async importLegacy(codeText: string, legacyApiBase = LEGACY_SYNC_API): Promise<AppConfig> {
    const code = parseSyncCode(codeText);
    const base = String(legacyApiBase || LEGACY_SYNC_API).replace(/\/+$/, '');
    const response = await this.transport.request({
      method: 'GET',
      url: `${base}/${encodeURIComponent(code.id)}`,
      headers: { accept: 'application/json' },
      timeoutMs: 15_000,
    });
    if (response.status === 404) throw new Error('旧版同步码不存在或已过期');
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`读取旧版配置失败：HTTP ${response.status}`);
    }
    const data = JSON.parse(response.bodyText || '{}');
    if (!data.blob) throw new Error('旧版同步数据为空');
    const plain = await decryptText(code.keyRaw, String(data.blob));
    return migrateLegacyConfig(JSON.parse(plain));
  }
}
