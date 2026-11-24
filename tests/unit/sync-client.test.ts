import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, SyncClient, createSyncCode, encryptText } from '@cx/core';
import type { AppConfig, HttpTransport, ProviderConfig, TransportResponse } from '@cx/core';

const provider: ProviderConfig = {
  id: 'p1',
  label: 'DeepSeek',
  baseURL: 'https://api.deepseek.com/v1',
  apiKey: 'sk-test',
  model: 'deepseek-chat',
  apiStyle: 'openai',
  role: 'fast',
  weight: 1,
  temperature: 0.1,
};

class MemoryHttpTransport implements HttpTransport {
  private readonly store = new Map<string, { blob: string; token: string }>();

  async request(options: {
    method: string;
    url: string;
    headers?: Record<string, string>;
    body?: string;
  }): Promise<TransportResponse> {
    const id = decodeURIComponent(new URL(options.url).pathname.split('/').pop() || '');
    if (options.method === 'PUT') {
      const body = JSON.parse(options.body || '{}');
      const existing = this.store.get(id);
      const token = options.headers?.['x-cxai-token'] || '';
      if (existing && existing.token !== token) return { status: 403, bodyText: '{"error":"forbidden"}' };
      this.store.set(id, { blob: body.blob, token });
      return { status: 200, bodyText: '{"ok":true}' };
    }
    const record = this.store.get(id);
    if (!record) return { status: 404, bodyText: '{"error":"not found"}' };
    return { status: 200, bodyText: JSON.stringify({ blob: record.blob, at: Date.now() }) };
  }

  put(id: string, blob: string, token = 'x') {
    this.store.set(id, { blob, token });
  }
}

describe('SyncClient', () => {
  it('pushes and pulls an encrypted config', async () => {
    const transport = new MemoryHttpTransport();
    const client = new SyncClient(transport, 'https://sync.test/api/sync');
    const config: AppConfig = { ...DEFAULT_CONFIG, providers: [provider] };
    const created = await client.createAndPush(config);
    const pulled = await client.pull(created.code);
    expect(pulled.config.providers[0].label).toBe('DeepSeek');
    expect(pulled.config.providers[0].apiKey).toBe('sk-test');
  });

  it('imports a legacy sync code and maps providers', async () => {
    const code = createSyncCode();
    const legacyConfig = {
      ai: {
        providers: [
          {
            id: 'legacy',
            label: 'Legacy DeepSeek',
            baseURL: 'https://api.deepseek.com/v1',
            apiKey: 'sk-old',
            model: 'deepseek-chat',
            role: 'judge',
          },
        ],
        judge: { voteThreshold: 0.72, timeoutMs: 90000 },
      },
    };
    const blob = await encryptText(code.keyRaw, JSON.stringify(legacyConfig));
    const transport = new MemoryHttpTransport();
    transport.put(code.id, blob);
    const client = new SyncClient(transport, 'https://sync.test/api/sync');
    const migrated = await client.importLegacy(code.code, 'https://sync.test/api/sync');
    expect(migrated.providers[0].label).toBe('Legacy DeepSeek');
    expect(migrated.providers[0].role).toBe('fast');
    expect(migrated.engine.requestTimeoutMs).toBe(30000);
  });
});
