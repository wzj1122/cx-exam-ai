export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

export function randInt(min: number, max: number): number {
  const lo = Math.ceil(Math.min(min, max));
  const hi = Math.floor(Math.max(min, max));
  return lo + Math.floor(Math.random() * (hi - lo + 1));
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function normText(text: unknown): string {
  return String(text == null ? '' : text)
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normKey(text: unknown): string {
  return normText(text)
    .replace(/[\uFF01-\uFF5E]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/[。．.、,，:：;；()（）[\]【】]/g, '')
    .toUpperCase();
}

export function unique<T>(list: T[]): T[] {
  return Array.from(new Set(list));
}

export function truncate(text: unknown, max: number): string {
  const value = String(text == null ? '' : text);
  return value.length <= max ? value : value.slice(0, Math.max(0, max - 1)) + '…';
}

export function stripHtml(html: unknown): string {
  return normText(
    String(html == null ? '' : html)
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<\/p>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&'),
  );
}

/** FNV-1a 32-bit. Used only for fingerprints, not security. */
export function hashString(input: unknown): string {
  const text = String(input == null ? '' : input);
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function withTimeout<T>(promise: Promise<T>, ms: number, label = '操作'): Promise<T> {
  if (!ms || ms <= 0) return promise;
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label}超时（${ms}ms）`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export function parseJsonLoose<T = unknown>(text: string): T | null {
  const raw = String(text == null ? '' : text).trim();
  if (!raw) return null;
  const unfenced = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  const candidates = [unfenced];
  const firstArray = unfenced.indexOf('[');
  const lastArray = unfenced.lastIndexOf(']');
  if (firstArray >= 0 && lastArray > firstArray) {
    candidates.push(unfenced.slice(firstArray, lastArray + 1));
  }
  const firstObject = unfenced.indexOf('{');
  const lastObject = unfenced.lastIndexOf('}');
  if (firstObject >= 0 && lastObject > firstObject) {
    candidates.push(unfenced.slice(firstObject, lastObject + 1));
  }
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate) as T;
    } catch {
      // continue
    }
  }
  return null;
}

export function normalizeAnswerToken(value: unknown): string {
  return normKey(value).replace(/[^A-Z0-9]/g, '');
}
