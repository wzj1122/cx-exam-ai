import type { QuestionAnswer, QuestionSnapshot } from '../types';
import { PROMPT_VERSION } from './prompts';

function optionHash(q: QuestionSnapshot): string {
  return q.options.map((o) => `${o.id}:${o.serverKey}:${o.text}`).join('|');
}

export function answerCacheKey(q: QuestionSnapshot, modelId: string): string {
  return [q.fingerprint, optionHash(q), modelId, PROMPT_VERSION].join('::');
}

export class AnswerCache {
  private readonly map = new Map<string, QuestionAnswer>();

  get(key: string): QuestionAnswer | null {
    return this.map.get(key) || null;
  }

  set(key: string, value: QuestionAnswer): void {
    this.map.set(key, value);
  }

  clear(): void {
    this.map.clear();
  }
}
