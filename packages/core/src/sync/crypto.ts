const TOKEN_MESSAGE = 'cx-exam-ai:write:v2';

function bytesToB64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64UrlToBytes(value: string): Uint8Array {
  const normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

function randomBytes(length: number): Uint8Array {
  const out = new Uint8Array(length);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(out);
  else for (let i = 0; i < length; i++) out[i] = Math.floor(Math.random() * 256);
  return out;
}

function utf8(text: string): Uint8Array {
  return new TextEncoder().encode(String(text));
}

function text(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

function bufferOf(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function subtle(): SubtleCrypto {
  const value = typeof crypto !== 'undefined' ? crypto.subtle : undefined;
  if (!value) throw new Error('当前环境没有 crypto.subtle（需要 https / 扩展 / 油猴环境）');
  return value;
}

async function aesKey(raw: Uint8Array, usage: KeyUsage): Promise<CryptoKey> {
  return subtle().importKey('raw', bufferOf(raw), { name: 'AES-GCM' }, false, [usage]);
}

export async function writeToken(raw: Uint8Array): Promise<string> {
  const key = await subtle().importKey('raw', bufferOf(raw), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await subtle().sign('HMAC', key, bufferOf(utf8(TOKEN_MESSAGE)));
  return bytesToB64Url(new Uint8Array(signature));
}

export async function encryptText(raw: Uint8Array, plain: string): Promise<string> {
  const iv = randomBytes(12);
  const encrypted = await subtle().encrypt(
    { name: 'AES-GCM', iv: bufferOf(iv) },
    await aesKey(raw, 'encrypt'),
    bufferOf(utf8(plain)),
  );
  const combined = new Uint8Array(iv.length + encrypted.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(encrypted), iv.length);
  return bytesToB64Url(combined);
}

export async function decryptText(raw: Uint8Array, blob: string): Promise<string> {
  const combined = b64UrlToBytes(blob);
  if (combined.length < 13) throw new Error('密文长度异常');
  const iv = combined.subarray(0, 12);
  const cipher = combined.subarray(12);
  const decrypted = await subtle().decrypt(
    { name: 'AES-GCM', iv: bufferOf(iv) },
    await aesKey(raw, 'decrypt'),
    bufferOf(cipher),
  );
  return text(new Uint8Array(decrypted));
}

export interface SyncCode {
  id: string;
  keyRaw: Uint8Array;
  code: string;
}

export function createSyncCode(): SyncCode {
  const id = bytesToB64Url(randomBytes(8));
  const keyRaw = randomBytes(16);
  return { id, keyRaw, code: `${id}.${bytesToB64Url(keyRaw)}` };
}

export function parseSyncCode(code: string): SyncCode {
  const value = String(code || '').trim();
  const match = /^([A-Za-z0-9_-]{6,48})\.([A-Za-z0-9_-]{16,60})$/.exec(value);
  if (!match) throw new Error('同步码格式不对（应形如 abc12345.xyz…）');
  return { id: match[1], keyRaw: b64UrlToBytes(match[2]), code: value };
}
