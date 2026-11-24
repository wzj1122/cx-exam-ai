import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ChaoxingAdapter, snapshotPaper } from '@cx/chaoxing';

const fixture = readFileSync(resolve(process.cwd(), 'tests/fixtures/exam-multi.html'), 'utf8');
const examUrl = 'https://mooc1.chaoxing.com/exam/test/reVersionTestStartNew?tId=2';
let clicks = 0;

function install() {
  clicks = 0;
  document.body.innerHTML = fixture;
  const input = document.querySelector('#answer2222222') as HTMLInputElement;
  const selected = new Set(input.value.split(''));
  document.querySelectorAll('.answerBg').forEach((row) => {
    row.addEventListener('click', () => {
      clicks++;
      const key = (row.querySelector('.num_option_dx') as HTMLElement).getAttribute('data') || '';
      if (selected.has(key)) selected.delete(key);
      else selected.add(key);
      input.value = Array.from(selected).sort().join('');
    });
  });
}

describe('multi-select apply', () => {
  beforeEach(install);

  it('removes only extras and adds only missing options', async () => {
    const paper = snapshotPaper(document, examUrl);
    const q = paper.questions[0];
    const adapter = new ChaoxingAdapter({ doc: document, url: examUrl, verifyTimeoutMs: 200, saveQuietMs: 0 });
    const result = await adapter.apply({
      questionId: q.id,
      fingerprint: q.fingerprint,
      targetOptionIds: ['O1', 'O2'],
      clearExtra: true,
    });
    expect(result.ok).toBe(true);
    expect((document.querySelector('#answer2222222') as HTMLInputElement).value).toBe('AB');
    expect(clicks).toBe(2);
  });

  it('does nothing when the selected set already matches', async () => {
    (document.querySelector('#answer2222222') as HTMLInputElement).value = 'AB';
    const paper = snapshotPaper(document, examUrl);
    const q = paper.questions[0];
    const adapter = new ChaoxingAdapter({ doc: document, url: examUrl, verifyTimeoutMs: 200, saveQuietMs: 0 });
    const result = await adapter.apply({
      questionId: q.id,
      fingerprint: q.fingerprint,
      targetOptionIds: ['O1', 'O2'],
      clearExtra: true,
    });
    expect(result.ok).toBe(true);
    expect(clicks).toBe(0);
  });

  it('refuses to clear options when the answer is empty', async () => {
    const paper = snapshotPaper(document, examUrl);
    const q = paper.questions[0];
    const adapter = new ChaoxingAdapter({ doc: document, url: examUrl, verifyTimeoutMs: 200, saveQuietMs: 0 });
    const result = await adapter.apply({
      questionId: q.id,
      fingerprint: q.fingerprint,
      targetOptionIds: [],
      clearExtra: true,
    });
    expect(result.ok).toBe(false);
    expect(result.failureCode).toBe('MANUAL_REQUIRED');
    expect(clicks).toBe(0);
  });
});
