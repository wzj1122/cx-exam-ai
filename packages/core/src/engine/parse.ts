import type { QuestionSnapshot } from '../types';
import { parseJsonLoose } from '../utils/text';

export interface ParsedAnswer {
  optionIds: string[];
  text: string;
  confidence: number;
  reason: string;
}

function normalizeConfidence(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0.7;
  if (n > 1 && n <= 100) return n / 100;
  return Math.min(1, Math.max(0.01, n));
}

export function parseAnswerObject(raw: unknown, q: QuestionSnapshot): ParsedAnswer | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const allowed = new Set(q.options.map((o) => o.id));
  const rawIds = obj.optionIds ?? obj.options ?? obj.answerOptionIds ?? obj.ids;
  let optionIds: string[] = [];
  if (Array.isArray(rawIds)) {
    optionIds = rawIds.map((id) => String(id).trim().toUpperCase());
  } else if (typeof rawIds === 'string') {
    optionIds = rawIds
      .split(/[,\s，、/]+/)
      .map((id) => id.trim().toUpperCase())
      .filter(Boolean);
  }
  if (!optionIds.length) {
    const fallback = obj.answer ?? obj.answerText;
    const values = Array.isArray(fallback) ? fallback : fallback != null ? [fallback] : [];
    for (const value of values) {
      const text = String(value == null ? '' : value).trim();
      const internal = /^O\d+$/i.test(text) ? text.toUpperCase() : '';
      if (internal && allowed.has(internal)) optionIds.push(internal);
      else {
        const byText = q.options.find((o) => o.text.trim() === text);
        if (byText) optionIds.push(byText.id);
      }
    }
  }
  optionIds = Array.from(new Set(optionIds.filter((id) => allowed.has(id))));
  const text = String(obj.text ?? obj.answerText ?? obj.answer ?? '').trim();
  if (!optionIds.length && !text) return null;
  return {
    optionIds,
    text,
    confidence: normalizeConfidence(obj.confidence),
    reason: String(obj.reason ?? obj.reasoning ?? '').slice(0, 240),
  };
}

export function parseBatchAnswers(text: string, questions: QuestionSnapshot[]): Map<string, ParsedAnswer> {
  const data = parseJsonLoose<unknown>(text);
  const out = new Map<string, ParsedAnswer>();
  const list = Array.isArray(data)
    ? data
    : data && typeof data === 'object' && Array.isArray((data as any).answers)
      ? (data as any).answers
      : data && typeof data === 'object' && Array.isArray((data as any).results)
        ? (data as any).results
        : [];
  const byId = new Map(questions.map((q) => [q.id, q]));
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const id = String((item as any).id ?? (item as any).questionId ?? '').trim();
    const q = byId.get(id);
    if (!q) continue;
    const parsed = parseAnswerObject(item, q);
    if (parsed) out.set(id, parsed);
  }
  return out;
}

export function parseVerifyObject(raw: unknown, q: QuestionSnapshot): {
  agree: boolean;
  answer: ParsedAnswer | null;
} {
  if (!raw || typeof raw !== 'object') return { agree: false, answer: null };
  const obj = raw as Record<string, unknown>;
  const parsed = parseAnswerObject(obj, q);
  return { agree: obj.agree === true, answer: parsed };
}
