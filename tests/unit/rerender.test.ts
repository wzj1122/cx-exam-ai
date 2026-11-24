import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ChaoxingAdapter, snapshotPaper } from '@cx/chaoxing';

const fixture = readFileSync(resolve(process.cwd(), 'tests/fixtures/exam-random-options.html'), 'utf8');
const examUrl = 'https://mooc1.chaoxing.com/exam/test/reVersionTestStartNew?tId=4';

describe('mid-apply re-render', () => {
  it('aborts instead of clicking an option in the replaced question', async () => {
    document.body.innerHTML = fixture;
    let clicks = 0;
    document.querySelectorAll('.answerBg').forEach((row) => {
      row.addEventListener('click', () => {
        clicks++;
        const root = document.querySelector('.questionLi') as HTMLElement;
        root.querySelector('.mark_name')!.textContent = '页面已经换成另一道题';
        root.querySelectorAll('.answer_p').forEach((el, index) => {
          el.textContent = `新选项 ${index + 1}`;
        });
      });
    });
    const paper = snapshotPaper(document, examUrl);
    const q = paper.questions[0];
    const adapter = new ChaoxingAdapter({ doc: document, url: examUrl, verifyTimeoutMs: 200, saveQuietMs: 0 });
    const result = await adapter.apply({
      questionId: q.id,
      fingerprint: q.fingerprint,
      targetOptionIds: ['O2'],
      clearExtra: true,
    });
    expect(result.ok).toBe(false);
    expect(['QUESTION_CHANGED', 'QUESTION_GONE']).toContain(result.failureCode);
    expect(clicks).toBeLessThanOrEqual(1);
  });
});
