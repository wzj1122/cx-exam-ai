import type { AppConfig, ProviderConfig } from '../types';
import { DEFAULT_CONFIG, mergeConfig } from '../config/defaults';

function asObject(value: unknown): Record<string, any> {
  return value && typeof value === 'object' ? (value as Record<string, any>) : {};
}

function mapProvider(raw: any, index: number): ProviderConfig | null {
  const item = asObject(raw);
  const baseURL = String(item.baseURL || item.baseUrl || item.url || '').trim();
  if (!baseURL && !item.id) return null;
  const roleRaw = String(item.role || 'judge');
  const role: ProviderConfig['role'] =
    roleRaw === 'vision' ? 'vision' : roleRaw === 'both' ? 'both' : roleRaw === 'verify' ? 'verify' : 'fast';
  return {
    id: String(item.id || `legacy-${index + 1}`),
    label: String(item.label || item.name || `模型 ${index + 1}`),
    baseURL,
    apiKey: String(item.apiKey || item.key || ''),
    model: String(item.model || ''),
    apiStyle: item.apiStyle === 'anthropic' ? 'anthropic' : item.apiStyle === 'gemini' ? 'gemini' : 'openai',
    role,
    weight: Number(item.weight) > 0 ? Number(item.weight) : 1,
    temperature: Number.isFinite(Number(item.temperature)) ? Number(item.temperature) : 0.1,
    maxTokens: Number(item.maxTokens) > 0 ? Number(item.maxTokens) : undefined,
    timeoutMs: Number(item.timeoutMs) > 0 ? Number(item.timeoutMs) : undefined,
    vision: item.vision === true,
  };
}

export function migrateLegacyConfig(raw: unknown): AppConfig {
  const root = asObject(raw);
  const ai = asObject(root.ai);
  const judge = asObject(ai.judge);
  const apply = asObject(root.apply);
  const engine = asObject(root.engine);
  const ui = asObject(root.ui);
  const providersRaw = Array.isArray(ai.providers) ? ai.providers : Array.isArray(root.providers) ? root.providers : [];
  const providers = providersRaw.map(mapProvider).filter((p): p is ProviderConfig => !!p);
  return mergeConfig(DEFAULT_CONFIG, {
    providers,
    engine: {
      ...DEFAULT_CONFIG.engine,
      concurrency: Number(judge.concurrency) > 0 ? Number(judge.concurrency) : DEFAULT_CONFIG.engine.concurrency,
      requestTimeoutMs:
        Number(judge.timeoutMs) > 0 ? Math.min(30_000, Number(judge.timeoutMs)) : DEFAULT_CONFIG.engine.requestTimeoutMs,
      verifyThreshold:
        Number(judge.voteThreshold) > 0 ? Number(judge.voteThreshold) : DEFAULT_CONFIG.engine.verifyThreshold,
      maxVerify: Number(judge.maxRounds) > 0 ? 1 : DEFAULT_CONFIG.engine.maxVerify,
      batchSize: Number(engine.prefetchConcurrency) > 0 ? 10 : DEFAULT_CONFIG.engine.batchSize,
    },
    apply: {
      ...DEFAULT_CONFIG.apply,
      verifyTimeoutMs:
        Number(apply.verifyMs) > 0 ? Number(apply.verifyMs) : DEFAULT_CONFIG.apply.verifyTimeoutMs,
      saveQuietMs: Number(apply.settleMs) > 0 ? Number(apply.settleMs) : DEFAULT_CONFIG.apply.saveQuietMs,
      maxActionRetries: Number(apply.retries) >= 0 ? 1 : DEFAULT_CONFIG.apply.maxActionRetries,
      clearExtra: apply.clearExtra !== false,
    },
    ui: {
      ...DEFAULT_CONFIG.ui,
      autoEnterPreview: true,
      riskDefaultExcluded: true,
      theme: ui.theme === 'dark' || ui.theme === 'light' ? ui.theme : 'auto',
    },
  });
}
