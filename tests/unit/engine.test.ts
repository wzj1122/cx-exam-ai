import { describe, expect, it } from 'vitest';
import { AnswerEngine } from '@cx/core';
import type { ExamPaper, ProviderConfig } from '@cx/core';

const provider: ProviderConfig = {
  id: 'fast',
  label: 'Fast',
  baseURL: 'https://example.test/v1',
  apiKey: 'x',
  model: 'test',
  apiStyle: 'openai',
  role: 'fast',
  weight: 1,
  temperature: 0.1,
};

const paper: ExamPaper = {
  id: 'p1',
  title: '模拟考试',
  url: 'https://mooc1.chaoxing.com/exam/test',
  mode: 'preview',
  canPreview: false,
  capturedAt: Date.now(),
  questions: [
    {
      id: '1234567',
      qid: '1234567',
      number: 1,
      type: 'single',
      typeLabel: '单选题',
      stem: 'TCP 三次握手第二步是？',
      options: [
        { id: 'O1', displayLabel: 'A', serverKey: 'D', text: 'SYN', keyConfidence: 'high', selectedDom: false, selectedServer: false },
        { id: 'O2', displayLabel: 'B', serverKey: 'A', text: 'SYN + ACK', keyConfidence: 'high', selectedDom: false, selectedServer: false },
      ],
      inputs: [],
      images: [],
      serverValue: '',
      domValue: '',
      answered: false,
      fingerprint: 'fp1',
    },
  ],
};

describe('AnswerEngine', () => {
  it('parses a batch answer and maps option ids to server keys', async () => {
    const engine = new AnswerEngine({
      providers: [provider],
      caller: async () => ({
        text: '{"answers":[{"id":"1234567","optionIds":["O2"],"confidence":0.9,"reason":"SYN+ACK"}]}',
        ms: 10,
        raw: {},
      }),
    });
    const answers = await engine.solvePaper(paper, () => {});
    expect(answers).toHaveLength(1);
    expect(answers[0].optionIds).toEqual(['O2']);
    expect(answers[0].serverKeys).toEqual(['A']);
    expect(answers[0].risk).toBe(false);
  });

  it('falls back to per-question when batch JSON is invalid', async () => {
    let calls = 0;
    const engine = new AnswerEngine({
      providers: [provider],
      caller: async () => {
        calls++;
        if (calls === 1) return { text: 'not json', ms: 1, raw: {} };
        return {
          text: '{"optionIds":["O2"],"confidence":0.8,"reason":"fallback"}',
          ms: 1,
          raw: {},
        };
      },
    });
    const answers = await engine.solvePaper(paper, () => {});
    expect(calls).toBeGreaterThanOrEqual(2);
    expect(answers[0].optionIds).toEqual(['O2']);
  });

  it('marks low-confidence answers as risk', async () => {
    const engine = new AnswerEngine({
      providers: [provider],
      verifyThreshold: 0.65,
      caller: async () => ({
        text: '{"answers":[{"id":"1234567","optionIds":["O1"],"confidence":0.2,"reason":"guess"}]}',
        ms: 1,
        raw: {},
      }),
    });
    const answers = await engine.solvePaper(paper, () => {});
    expect(answers[0].risk).toBe(true);
    expect(answers[0].riskReasons.join(' ')).toContain('置信度');
  });
});
