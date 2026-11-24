import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { AnswerEngine } from '@cx/core';
import type { ProviderConfig } from '@cx/core';
import { ChaoxingAdapter, snapshotPaper } from '@cx/chaoxing';

const fixture = readFileSync(resolve(process.cwd(), 'tests/fixtures/exam-random-options.html'), 'utf8');
const examUrl = 'https://mooc1.chaoxing.com/exam/test/reVersionTestStartNew?tId=1';

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

describe('end-to-end core flow', () => {
  it('model answers O2, adapter clicks only server key A', async () => {
    document.body.innerHTML = fixture;
    const input = document.querySelector('#answer1234567') as HTMLInputElement;
    let clicks = 0;
    document.querySelectorAll('.answerBg').forEach((row) => {
      row.addEventListener('click', () => {
        clicks++;
        const label = row.querySelector('.num_option') as HTMLElement;
        input.value = label.getAttribute('data') || '';
        document.querySelectorAll('.check_answer').forEach((el) => el.classList.remove('check_answer'));
        (row.querySelector('.answer_p') as HTMLElement).classList.add('check_answer');
      });
    });

    const paper = snapshotPaper(document, examUrl);
    const q = paper.questions[0];
    const engine = new AnswerEngine({
      providers: [provider],
      caller: async () => ({
        text: '{"answers":[{"id":"1234567","optionIds":["O2"],"confidence":0.92,"reason":"SYN+ACK"}]}',
        ms: 5,
        raw: {},
      }),
    });
    const [answer] = await engine.solvePaper(paper, () => {});
    expect(answer.serverKeys).toEqual(['A']);

    const adapter = new ChaoxingAdapter({ doc: document, url: examUrl, verifyTimeoutMs: 200, saveQuietMs: 0 });
    const result = await adapter.apply({
      questionId: q.id,
      fingerprint: q.fingerprint,
      targetOptionIds: answer.optionIds,
      clearExtra: true,
    });
    expect(result.ok).toBe(true);
    expect(input.value).toBe('A');
    expect(clicks).toBe(1);
  });
});
