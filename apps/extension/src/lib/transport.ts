import type { HttpTransport, TransportResponse } from '@cx/core';

export class BackgroundTransport implements HttpTransport {
  async request(options: {
    method: string;
    url: string;
    headers?: Record<string, string>;
    body?: string;
    timeoutMs?: number;
  }): Promise<TransportResponse> {
    const response = await chrome.runtime.sendMessage({
      type: 'CX_HTTP',
      options,
    });
    if (!response?.ok) throw new Error(response?.error || '后台请求失败');
    return response.data as TransportResponse;
  }
}
