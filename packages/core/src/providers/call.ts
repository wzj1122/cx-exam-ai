import type {
  ChatMessage,
  HttpTransport,
  ProviderCallOptions,
  ProviderCallResult,
  ProviderCaller,
  ProviderConfig,
} from '../types';
import { randInt, sleep, withTimeout } from '../utils/text';
import { joinUrl, requestJson } from './http';

function systemAndUser(messages: ChatMessage[]): { system: string; rest: ChatMessage[] } {
  const system = messages
    .filter((m) => m.role === 'system')
    .map((m) => m.content)
    .join('\n\n')
    .trim();
  const rest = messages.filter((m) => m.role !== 'system');
  return { system, rest };
}

function extractOpenAIText(data: any): string {
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part: any) => (typeof part === 'string' ? part : part?.text || ''))
      .join('');
  }
  if (typeof data?.output_text === 'string') return data.output_text;
  if (typeof data?.response === 'string') return data.response;
  if (typeof data?.answer === 'string') return data.answer;
  return '';
}

function extractAnthropicText(data: any): string {
  if (Array.isArray(data?.content)) {
    return data.content
      .map((part: any) => (typeof part === 'string' ? part : part?.text || ''))
      .join('');
  }
  return typeof data?.completion === 'string' ? data.completion : '';
}

function extractGeminiText(data: any): string {
  const parts = data?.candidates?.[0]?.content?.parts;
  if (Array.isArray(parts)) {
    return parts.map((part: any) => (typeof part === 'string' ? part : part?.text || '')).join('');
  }
  return '';
}

function openAIRequest(provider: ProviderConfig, options: ProviderCallOptions) {
  const body: Record<string, unknown> = {
    model: provider.model,
    messages: options.messages,
    temperature: options.temperature ?? provider.temperature ?? 0.1,
  };
  const maxTokens = options.maxTokens ?? provider.maxTokens;
  if (maxTokens && maxTokens > 0) body.max_tokens = maxTokens;
  return {
    url: joinUrl(provider.baseURL, 'chat/completions'),
    headers: {
      'content-type': 'application/json',
      ...(provider.apiKey ? { authorization: `Bearer ${provider.apiKey}` } : {}),
    },
    body: JSON.stringify(body),
  };
}

function anthropicRequest(provider: ProviderConfig, options: ProviderCallOptions) {
  const { system, rest } = systemAndUser(options.messages);
  const body: Record<string, unknown> = {
    model: provider.model,
    max_tokens: options.maxTokens ?? provider.maxTokens ?? 4096,
    temperature: options.temperature ?? provider.temperature ?? 0.1,
    messages: rest.map((m) => ({ role: m.role, content: m.content })),
  };
  if (system) body.system = system;
  return {
    url: joinUrl(provider.baseURL, 'v1/messages'),
    headers: {
      'content-type': 'application/json',
      'anthropic-version': '2023-06-01',
      ...(provider.apiKey ? { 'x-api-key': provider.apiKey } : {}),
    },
    body: JSON.stringify(body),
  };
}

function geminiRequest(provider: ProviderConfig, options: ProviderCallOptions) {
  const { system, rest } = systemAndUser(options.messages);
  const body: Record<string, unknown> = {
    contents: rest.map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    })),
    generationConfig: {
      temperature: options.temperature ?? provider.temperature ?? 0.1,
      ...(options.maxTokens || provider.maxTokens
        ? { maxOutputTokens: options.maxTokens ?? provider.maxTokens }
        : {}),
    },
  };
  if (system) body.systemInstruction = { parts: [{ text: system }] };
  const model = encodeURIComponent(provider.model);
  const base = String(provider.baseURL || '')
    .replace(/\/+$/, '')
    .replace(/\/v1beta$/i, '');
  const url = `${base}/v1beta/models/${model}:generateContent?key=${encodeURIComponent(provider.apiKey)}`;
  return {
    url,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  };
}

export function createProviderCaller(transport: HttpTransport): ProviderCaller {
  return async (provider, options): Promise<ProviderCallResult> => {
    if (!provider.baseURL) throw new Error(`${provider.label || provider.id} 没有配置 Base URL`);
    if (!provider.model) throw new Error(`${provider.label || provider.id} 没有配置模型名`);
    const timeoutMs = options.timeoutMs || provider.timeoutMs || 25_000;
    const request =
      provider.apiStyle === 'anthropic'
        ? anthropicRequest(provider, options)
        : provider.apiStyle === 'gemini'
          ? geminiRequest(provider, options)
          : openAIRequest(provider, options);
    let lastError: unknown = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      const started = Date.now();
      try {
        const response = await withTimeout(
          transport.request({
            method: 'POST',
            url: request.url,
            headers: request.headers,
            body: request.body,
            timeoutMs,
          }),
          timeoutMs,
          `${provider.label || provider.id} 请求`,
        );
        const data = requestJson<any>(response, provider.label || provider.id);
        const text =
          provider.apiStyle === 'anthropic'
            ? extractAnthropicText(data)
            : provider.apiStyle === 'gemini'
              ? extractGeminiText(data)
              : extractOpenAIText(data);
        if (!String(text || '').trim()) {
          throw new Error(`${provider.label || provider.id} 返回空内容：${JSON.stringify(data).slice(0, 200)}`);
        }
        return { text: String(text), ms: Date.now() - started, raw: data };
      } catch (error) {
        lastError = error;
        const message = error instanceof Error ? error.message : String(error);
        const retryable = /HTTP (429|500|502|503|504)|network|ECONN|fetch/i.test(message);
        if (!retryable || attempt >= 2) throw error;
        await sleep(400 * 2 ** attempt + randInt(0, 250));
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  };
}

export async function listModels(provider: ProviderConfig, transport: HttpTransport): Promise<string[]> {
  if (!provider.baseURL) throw new Error('请先填写 Base URL');
  const timeoutMs = 12_000;
  let url = '';
  let headers: Record<string, string> = { 'content-type': 'application/json' };
  if (provider.apiStyle === 'anthropic') {
    url = joinUrl(provider.baseURL, 'v1/models');
    headers = {
      ...headers,
      'anthropic-version': '2023-06-01',
      ...(provider.apiKey ? { 'x-api-key': provider.apiKey } : {}),
    };
  } else if (provider.apiStyle === 'gemini') {
    url = `${String(provider.baseURL)
      .replace(/\/+$/, '')
      .replace(/\/v1beta$/i, '')}/v1beta/models?key=${encodeURIComponent(provider.apiKey)}`;
  } else {
    url = joinUrl(provider.baseURL, 'models');
    if (provider.apiKey) headers.authorization = `Bearer ${provider.apiKey}`;
  }
  const response = await transport.request({ method: 'GET', url, headers, timeoutMs });
  const data = requestJson<any>(response, '模型列表');
  const items = data?.data || data?.models || [];
  return Array.from(
    new Set(
      (Array.isArray(items) ? items : [])
        .map((item: any) => String(item?.id || item?.name || '').replace(/^models\//, ''))
        .filter(Boolean),
    ),
  );
}

export async function pingProvider(
  provider: ProviderConfig,
  transport: HttpTransport,
): Promise<{ ok: boolean; ms: number; text: string }> {
  const caller = createProviderCaller(transport);
  const started = Date.now();
  const result = await caller(provider, {
    messages: [
      { role: 'system', content: '你是一个连通性测试端点，只输出 JSON。' },
      { role: 'user', content: '输出 {"ok":true}' },
    ],
    temperature: 0,
    maxTokens: 32,
    timeoutMs: 12_000,
  });
  return { ok: true, ms: Date.now() - started, text: result.text.slice(0, 120) };
}
