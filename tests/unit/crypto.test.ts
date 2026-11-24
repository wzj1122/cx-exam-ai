import { describe, expect, it } from 'vitest';
import { createSyncCode, decryptText, encryptText, parseSyncCode } from '@cx/core';

describe('sync crypto', () => {
  it('round-trips a sync code', async () => {
    const code = createSyncCode();
    const parsed = parseSyncCode(code.code);
    expect(parsed.id).toBe(code.id);
    const blob = await encryptText(code.keyRaw, '{"hello":"world"}');
    const plain = await decryptText(parsed.keyRaw, blob);
    expect(plain).toBe('{"hello":"world"}');
  });

  it('rejects malformed sync codes', () => {
    expect(() => parseSyncCode('bad')).toThrow();
  });
});
