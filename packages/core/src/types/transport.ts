import type { ProviderConfig } from './domain';

export interface TransportResponse {
  status: number;
  bodyText: string;
  headers?: Record<string, string>;
}

export interface HttpTransport {
  request(options: {
    method: string;
    url: string;
    headers?: Record<string, string>;
    body?: string;
    timeoutMs?: number;
  }): Promise<TransportResponse>;
}

export interface StorageAdapter {
  get<T>(key: string, fallback: T): Promise<T>;
  set<T>(key: string, value: T): Promise<void>;
  remove(key: string): Promise<void>;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ProviderCallOptions {
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  json?: boolean;
}

export interface ProviderCallResult {
  text: string;
  ms: number;
  raw: unknown;
}

export type ProviderCaller = (
  provider: ProviderConfig,
  options: ProviderCallOptions,
) => Promise<ProviderCallResult>;
