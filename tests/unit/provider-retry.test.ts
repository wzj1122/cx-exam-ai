import { describe, expect, it } from 'vitest';
import { createProviderCaller } from '@cx/core';
import type { HttpTransport, ProviderConfig } from '@cx/core';

const provider: ProviderConfig = {
  id: 'p1',
  label: 'Mock',
  baseURL: 'https://mock.test/v1',
  apiKey: 'sk-test',
  model: 'mock-model',
  apiStyle: 'openai',
  role: 'fast',
  weight: 1,
  temperature: 0.1,
};

describe('provider retry', () => {
  it('retries a 429 once and then succeeds', async () => {
    let calls = 0;
    const transport: HttpTransport = {
      async request() {
        calls++;
        if (calls === 1) return { status: 429, bodyText: '{"error":{"message":"rate limited"}}' };
        return {
          status: 200,
          bodyText: JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] }),
        };
      },
    };
    const caller = createProviderCaller(transport);
    const result = await caller(provider, {
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(calls).toBe(2);
    expect(result.text).toContain('ok');
  });
});
