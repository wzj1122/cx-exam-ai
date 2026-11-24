import type {
  AnswerStage,
  ExamPaper,
  ProviderCaller,
  ProviderConfig,
  QuestionAnswer,
  QuestionSnapshot,
} from '../types';
import { sleep, withTimeout } from '../utils/text';
import { AnswerCache, answerCacheKey } from './cache';
import {
  batchSolveSystem,
  batchSolveUser,
  singleSolveSystem,
  singleSolveUser,
  verifySystem,
  verifyUser,
  arbiterSystem,
  arbiterUser,
} from './prompts';
import { parseAnswerObject, parseBatchAnswers, parseVerifyObject, type ParsedAnswer } from './parse';
import { assessRisk } from './risk';

export interface AnswerEngineOptions {
  providers: ProviderConfig[];
  batchSize?: number;
  batchChars?: number;
  concurrency?: number;
  requestTimeoutMs?: number;
  questionTimeoutMs?: number;
  verifyThreshold?: number;
  maxVerify?: number;
  maxArbiter?: number;
  fastTemperature?: number;
  caller: ProviderCaller;
  onLog?: (message: string) => void;
}

export interface SolveOptions {
  /** Only solve these questions; omitted = all. */
  questionIds?: string[];
  /** Force a fresh call, bypass cache. */
  force?: boolean;
}

function isChoiceQuestion(q: QuestionSnapshot): boolean {
  return (
    q.options.length > 0 &&
    q.images.length === 0 &&
    (q.type === 'single' || q.type === 'multiple' || q.type === 'judgement')
  );
}

function chunkQuestions(questions: QuestionSnapshot[], maxCount: number, maxChars: number): QuestionSnapshot[][] {
  const chunks: QuestionSnapshot[][] = [];
  let current: QuestionSnapshot[] = [];
  let chars = 0;
  for (const q of questions) {
    const size = q.stem.length + q.options.reduce((sum, o) => sum + o.text.length + 8, 0);
    if (current.length && (current.length >= maxCount || chars + size > maxChars)) {
      chunks.push(current);
      current = [];
      chars = 0;
    }
    current.push(q);
    chars += size;
  }
  if (current.length) chunks.push(current);
  return chunks;
}

async function runPool<T>(tasks: Array<() => Promise<T>>, concurrency: number): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(concurrency, tasks.length)) }, async () => {
    while (cursor < tasks.length) {
      const index = cursor++;
      results[index] = await tasks[index]();
    }
  });
  await Promise.all(workers);
  return results;
}

export class AnswerEngine {
  private readonly cache = new AnswerCache();
  private readonly opts: Required<Omit<AnswerEngineOptions, 'onLog' | 'caller'>> & {
    caller: ProviderCaller;
    onLog?: (message: string) => void;
  };

  constructor(options: AnswerEngineOptions) {
    this.opts = {
      providers: options.providers,
      batchSize: options.batchSize ?? 10,
      batchChars: options.batchChars ?? 6000,
      concurrency: options.concurrency ?? 4,
      requestTimeoutMs: options.requestTimeoutMs ?? 25_000,
      questionTimeoutMs: options.questionTimeoutMs ?? 15_000,
      verifyThreshold: options.verifyThreshold ?? 0.65,
      maxVerify: options.maxVerify ?? 1,
      maxArbiter: options.maxArbiter ?? 1,
      fastTemperature: options.fastTemperature ?? 0.1,
      caller: options.caller,
      onLog: options.onLog,
    };
  }

  private log(message: string): void {
    this.opts.onLog?.(message);
  }

  private pickProvider(kind: 'fast' | 'verify' | 'vision'): ProviderConfig | null {
    const all = this.opts.providers;
    const exact = all.filter((p) => p.role === kind);
    if (exact.length) return exact.sort((a, b) => (b.weight || 1) - (a.weight || 1))[0];
    const both = all.filter((p) => p.role === 'both');
    if (both.length) return both.sort((a, b) => (b.weight || 1) - (a.weight || 1))[0];
    if (kind === 'fast') return all[0] || null;
    return null;
  }

  private pickVerifier(fast: ProviderConfig | null): ProviderConfig | null {
    const all = this.opts.providers;
    const candidates = all.filter((p) => p.role === 'verify' || p.role === 'both');
    const different = candidates.filter((p) => p.id !== fast?.id);
    return (different.length ? different : candidates)[0] || null;
  }

  async solvePaper(
    paper: ExamPaper,
    onAnswer: (answer: QuestionAnswer) => void,
    options: SolveOptions = {},
  ): Promise<QuestionAnswer[]> {
    const wanted = options.questionIds?.length
      ? paper.questions.filter((q) => options.questionIds!.includes(q.id))
      : paper.questions;
    if (!wanted.length) return [];
    const fast = this.pickProvider('fast');
    if (!fast) throw new Error('没有启用的模型：请先在设置里添加 fast 模型');

    const choice = wanted.filter(isChoiceQuestion);
    const batches = chunkQuestions(choice, this.opts.batchSize, this.opts.batchChars);
    this.log(`快答：${choice.length} 道选择题分 ${batches.length} 批，${wanted.length - choice.length} 道逐题`);

    const batchAnswers = new Map<string, QuestionAnswer>();
    await runPool(
      batches.map((batch) => async () => {
        const answers = await this.solveBatch(batch, fast, options.force);
        for (const answer of answers) {
          batchAnswers.set(answer.questionId, answer);
          onAnswer(answer);
        }
      }),
      Math.max(1, Math.min(this.opts.concurrency, 3)),
    );

    const remaining = wanted.filter((q) => !batchAnswers.has(q.id));
    await runPool(
      remaining.map((q) => async () => {
        try {
          const answer = await this.solveOne(q, fast, options.force);
          batchAnswers.set(q.id, answer);
          onAnswer(answer);
        } catch (error) {
          this.log(`第 ${q.number} 题失败：${error instanceof Error ? error.message : String(error)}`);
        }
      }),
      this.opts.concurrency,
    );

    const ordered = wanted
      .map((q) => batchAnswers.get(q.id))
      .filter((answer): answer is QuestionAnswer => !!answer);
    return ordered;
  }

  private async solveBatch(
    questions: QuestionSnapshot[],
    provider: ProviderConfig,
    force?: boolean,
  ): Promise<QuestionAnswer[]> {
    const cached: QuestionAnswer[] = [];
    const pending: QuestionSnapshot[] = [];
    for (const q of questions) {
      if (!force) {
        const hit = this.cache.get(answerCacheKey(q, provider.id));
        if (hit) cached.push(hit);
        else pending.push(q);
      } else {
        pending.push(q);
      }
    }
    if (!pending.length) return cached;
    try {
      const result = await withTimeout(
        this.opts.caller(provider, {
          messages: [
            { role: 'system', content: batchSolveSystem() },
            { role: 'user', content: batchSolveUser(pending) },
          ],
          temperature: this.opts.fastTemperature,
          maxTokens: Math.max(1800, pending.length * 320),
          timeoutMs: this.opts.requestTimeoutMs,
        }),
        this.opts.requestTimeoutMs,
        '批量快答',
      );
      const parsed = parseBatchAnswers(result.text, pending);
      const out: QuestionAnswer[] = [];
      for (const q of pending) {
        const hit = parsed.get(q.id);
        if (!hit) {
          try {
            out.push(await this.solveOne(q, provider, force));
          } catch (error) {
            this.log(`第 ${q.number} 题批量缺项后单题失败：${error instanceof Error ? error.message : String(error)}`);
          }
          continue;
        }
        out.push(await this.finalize(q, hit, provider, 'fast'));
      }
      for (const answer of out) {
        const q = pending.find((item) => item.id === answer.questionId);
        if (q) this.cache.set(answerCacheKey(q, provider.id), answer);
      }
      return cached.concat(out);
    } catch (error) {
      this.log(`批量快答失败，拆成单题：${error instanceof Error ? error.message : String(error)}`);
      const out = cached.slice();
      for (const q of pending) {
        try {
          out.push(await this.solveOne(q, provider, force));
        } catch (singleError) {
          this.log(`第 ${q.number} 题单题失败：${singleError instanceof Error ? singleError.message : String(singleError)}`);
        }
      }
      return out;
    }
  }

  private async solveOne(
    q: QuestionSnapshot,
    provider: ProviderConfig,
    force?: boolean,
  ): Promise<QuestionAnswer> {
    const key = answerCacheKey(q, provider.id);
    if (!force) {
      const hit = this.cache.get(key);
      if (hit) return hit;
    }
    const result = await withTimeout(
      this.opts.caller(provider, {
        messages: [
          { role: 'system', content: singleSolveSystem() },
          { role: 'user', content: singleSolveUser(q) },
        ],
        temperature: this.opts.fastTemperature,
        maxTokens: q.options.length ? 1800 : 4000,
        timeoutMs: this.opts.questionTimeoutMs,
      }),
      this.opts.questionTimeoutMs,
      `第 ${q.number} 题快答`,
    );
    const raw = JSON.parse(JSON.stringify(result.raw ?? null));
    const obj = parseAnswerObject(this.extractObject(result.text), q);
    if (!obj) throw new Error('模型返回无法解析为答案 JSON');
    const answer = await this.finalize(q, obj, provider, 'fast');
    this.cache.set(key, answer);
    return answer;
  }

  private extractObject(text: string): unknown {
    try {
      const parsed = JSON.parse(
        String(text)
          .replace(/^```(?:json)?\s*/i, '')
          .replace(/\s*```$/i, '')
          .trim(),
      );
      return parsed;
    } catch {
      return null;
    }
  }

  private async finalize(
    q: QuestionSnapshot,
    parsed: ParsedAnswer,
    provider: ProviderConfig,
    stage: AnswerStage,
    extraRiskReasons: string[] = [],
  ): Promise<QuestionAnswer> {
    let current = parsed;
    let currentStage = stage;
    let confidence = current.confidence;
    const reasons = [...extraRiskReasons];
    const verify = this.pickVerifier(provider);
    const needsVerify =
      !!verify &&
      (current.optionIds.length
        ? current.confidence < this.opts.verifyThreshold ||
          q.options.some((o) => current.optionIds.includes(o.id) && o.keyConfidence === 'low')
        : q.options.length === 0 && !current.text);
    if (needsVerify && this.opts.maxVerify > 0) {
      try {
        const check = await this.callVerify(q, current, verify);
        if (check) {
          if (check.agree) {
            confidence = Math.max(confidence, check.answer?.confidence ?? confidence);
            currentStage = 'verify';
          } else if (check.answer && (check.answer.optionIds.length || check.answer.text)) {
            current = check.answer;
            confidence = check.answer.confidence;
            currentStage = 'verify';
            reasons.push('复核与首答不一致');
          }
        }
      } catch (error) {
        reasons.push(`复核失败：${error instanceof Error ? error.message : String(error)}`);
      }
    }
    if (reasons.length && currentStage !== 'fast') {
      const arbiter = this.pickProvider('verify');
      if (arbiter && this.opts.maxArbiter > 0 && arbiter.id !== provider.id) {
        try {
          const arb = await this.opts.caller(arbiter, {
            messages: [
              { role: 'system', content: arbiterSystem() },
              { role: 'user', content: arbiterUser(q, parsed.optionIds, current.optionIds, false) },
            ],
            temperature: 0,
            maxTokens: q.options.length ? 1800 : 4000,
            timeoutMs: this.opts.requestTimeoutMs,
          });
          const obj = parseAnswerObject(this.extractObject(arb.text), q);
          if (obj && (obj.optionIds.length || obj.text)) {
            current = obj;
            confidence = obj.confidence;
            currentStage = 'arbiter';
            reasons.push('仲裁改判');
          }
        } catch (error) {
          reasons.push(`仲裁失败：${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }
    if ((q.type === 'single' || q.type === 'judgement') && current.optionIds.length > 1) {
      current = { ...current, optionIds: current.optionIds.slice(0, 1) };
      confidence = Math.min(confidence, 0.7);
      reasons.push('单选/判断题返回了多个选项，已只取第一个');
    }
    const serverKeys = current.optionIds
      .map((id) => q.options.find((o) => o.id === id)?.serverKey || '')
      .filter(Boolean);
    const base: Omit<QuestionAnswer, 'risk' | 'riskReasons'> = {
      questionId: q.id,
      optionIds: current.optionIds,
      serverKeys,
      answerText: current.text,
      confidence,
      reason: current.reason,
      stage: currentStage,
      timingMs: 0,
    };
    const risk = assessRisk(q, base, this.opts.verifyThreshold);
    return {
      ...base,
      risk: risk.risk || reasons.length > 0,
      riskReasons: Array.from(new Set([...risk.reasons, ...reasons])),
    };
  }

  private async callVerify(
    q: QuestionSnapshot,
    candidate: ParsedAnswer,
    provider: ProviderConfig,
  ): Promise<{ agree: boolean; answer: ParsedAnswer | null } | null> {
    const result = await withTimeout(
      this.opts.caller(provider, {
        messages: [
          { role: 'system', content: verifySystem() },
          { role: 'user', content: verifyUser(q, candidate.optionIds, candidate.text) },
        ],
        temperature: 0,
        maxTokens: 1200,
        timeoutMs: this.opts.requestTimeoutMs,
      }),
      this.opts.requestTimeoutMs,
      `第 ${q.number} 题复核`,
    );
    const obj = this.extractObject(result.text);
    if (!obj) return null;
    return parseVerifyObject(obj, q);
  }

  async verify(q: QuestionSnapshot, answer: QuestionAnswer): Promise<QuestionAnswer> {
    const verifier = this.pickVerifier(this.pickProvider('fast'));
    if (!verifier) return answer;
    const parsed = await this.callVerify(
      q,
      {
        optionIds: answer.optionIds,
        text: answer.answerText,
        confidence: answer.confidence,
        reason: answer.reason,
      },
      verifier,
    );
    if (!parsed) return answer;
    const next = parsed.answer || {
      optionIds: answer.optionIds,
      text: answer.answerText,
      confidence: answer.confidence,
      reason: answer.reason,
    };
    const serverKeys = next.optionIds
      .map((id) => q.options.find((o) => o.id === id)?.serverKey || '')
      .filter(Boolean);
    const base: Omit<QuestionAnswer, 'risk' | 'riskReasons'> = {
      ...answer,
      optionIds: next.optionIds,
      serverKeys,
      answerText: next.text,
      confidence: parsed.agree ? Math.max(answer.confidence, next.confidence) : next.confidence,
      reason: next.reason,
      stage: 'verify',
    };
    const risk = assessRisk(q, base, this.opts.verifyThreshold);
    return {
      ...base,
      risk: risk.risk || !parsed.agree,
      riskReasons: Array.from(new Set([...risk.reasons, ...(parsed.agree ? [] : ['复核不同意首答'])])),
    };
  }
}
