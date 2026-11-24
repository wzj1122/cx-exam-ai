import type { HttpTransport, TransportResponse } from '@cx/core';

export class GmTransport implements HttpTransport {
  async request(options: {
    method: string;
    url: string;
    headers?: Record<string, string>;
    body?: string;
    timeoutMs?: number;
  }): Promise<TransportResponse> {
    if (typeof GM_xmlhttpRequest === 'function') {
      return new Promise((resolve, reject) => {
        GM_xmlhttpRequest({
          method: options.method,
          url: options.url,
          headers: options.headers,
          data: options.body,
          timeout: options.timeoutMs || 25_000,
          anonymous: true,
          onload: (response) => {
            resolve({
              status: response.status,
              bodyText: String(response.responseText ?? response.response ?? ''),
            });
          },
          onerror: (error) => reject(new Error(typeof error === 'string' ? error : '网络错误')),
          ontimeout: () => reject(new Error('请求超时')),
        });
      });
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs || 25_000);
    try {
      const response = await fetch(options.url, {
        method: options.method,
        headers: options.headers,
        body: options.body,
        signal: controller.signal,
      });
      return { status: response.status, bodyText: await response.text() };
    } finally {
      clearTimeout(timeout);
    }
  }
}
