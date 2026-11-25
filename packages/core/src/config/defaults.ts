import type { AppConfig } from '../types';

export const CONFIG_VERSION = 2;

export const DEFAULT_CONFIG: AppConfig = {
  version: CONFIG_VERSION,
  providers: [],
  engine: {
    batchSize: 10,
    batchChars: 6000,
    concurrency: 4,
    requestTimeoutMs: 25_000,
    questionTimeoutMs: 15_000,
    verifyThreshold: 0.65,
    maxVerify: 1,
    maxArbiter: 1,
    fastTemperature: 0.1,
  },
  apply: {
    verifyTimeoutMs: 1600,
    saveQuietMs: 450,
    maxActionRetries: 1,
    clearExtra: true,
  },
  ui: {
    theme: 'auto',
    riskDefaultExcluded: true,
    autoEnterPreview: true,
    autoStart: true,
    showServerKey: true,
  },
  sync: {
    apiBase: 'https://cx-exam-ai-app.pages.dev/api/sync',
    code: '',
  },
};

export const APP_NAME = 'CX 考试 AI 大脑';
export const APP_VERSION = '2.0.1';
export const GREASYFORK_ID = 605687;
export const SETTINGS_URL = 'https://cx-exam-ai-app.pages.dev/settings';
export const LEGACY_SYNC_API = 'https://cx-exam-ai.pages.dev/api/sync';

export function mergeConfig(base: AppConfig, patch: Partial<AppConfig> | null | undefined): AppConfig {
  const input = patch || {};
  return {
    ...base,
    ...input,
    version: CONFIG_VERSION,
    providers: Array.isArray(input.providers) ? input.providers : base.providers,
    engine: { ...base.engine, ...(input.engine || {}) },
    apply: { ...base.apply, ...(input.apply || {}) },
    ui: { ...base.ui, ...(input.ui || {}) },
    sync: { ...base.sync, ...(input.sync || {}) },
  };
}
