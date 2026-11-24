import type { HttpTransport, TransportResponse } from '../types/transport';

export class FetchTransport implements HttpTransport {
  async request(options: {
    method: string;
    url: string;
    headers?: Record<string, string>;
    body?: string;
    timeoutMs?: number;
  }): Promise<TransportResponse> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs || 25_000);
    try {
      const response = await fetch(options.url, {
        method: options.method,
        headers: options.headers,
        body: options.body,
        signal: controller.signal,
      });
      const bodyText = await response.text();
      return { status: response.status, bodyText };
    } finally {
      clearTimeout(timeout);
    }
  }
}

export function joinUrl(base: string, path: string): string {
  const root = String(base || '').replace(/\/+$/, '');
  const tail = String(path || '').replace(/^\/+/, '');
  if (!root) return tail;
  if (root.endsWith('/' + tail) || root.endsWith('/' + tail.replace(/^v1\//, ''))) return root;
  if (/\/v1$/i.test(root) && tail.startsWith('v1/')) return `${root}/${tail.slice(3)}`;
  if (/\/chat\/completions$/i.test(root) && tail === 'chat/completions') return root;
  if (/\/messages$/i.test(root) && tail === 'v1/messages') return root;
  return `${root}/${tail}`;
}

export function requestJson<T = unknown>(response: TransportResponse, label = '接口'): T {
  let data: unknown = null;
  try {
    data = JSON.parse(response.bodyText);
  } catch {
    // handled below
  }
  if (response.status < 200 || response.status >= 300) {
    const detail =
      data && typeof data === 'object'
        ? ((data as Record<string, unknown>).error as Record<string, unknown> | undefined)?.message ||
          (data as Record<string, unknown>).message ||
          (data as Record<string, unknown>).error
        : '';
    throw new Error(`${label} HTTP ${response.status}${detail ? `：${String(detail).slice(0, 300)}` : ''}`);
  }
  if (data == null) throw new Error(`${label}返回不是 JSON：${response.bodyText.slice(0, 200)}`);
  return data as T;
}
