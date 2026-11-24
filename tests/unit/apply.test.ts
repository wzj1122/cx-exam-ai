import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ChaoxingAdapter, snapshotPaper } from '@cx/chaoxing';

const fixture = readFileSync(resolve(process.cwd(), 'tests/fixtures/exam-random-options.html'), 'utf8');
const examUrl = 'https://mooc1.chaoxing.com/exam/test/reVersionTestStartNew?tId=1';

let clicks = 0;

function installMockPage() {
  clicks = 0;
  document.body.innerHTML = fixture;
  const input = document.querySelector('#answer1234567') as HTMLInputElement;
  document.querySelectorAll('.answerBg').forEach((row) => {
    row.addEventListener('click', () => {
      clicks++;
      const label = row.querySelector('.num_option') as HTMLElement;
      const key = label.getAttribute('data') || '';
      input.value = key;
      document.querySelectorAll('.answerBg .answer_p').forEach((el) => el.classList.remove('check_answer'));
      (row.querySelector('.answer_p') as HTMLElement).classList.add('check_answer');
    });
  });
}

describe('Chaoxing apply protocol', () => {
  beforeEach(installMockPage);

  it('clicks only the option whose server key matches the target', async () => {
    const paper = snapshotPaper(document, examUrl);
    const q = paper.questions[0];
    const adapter = new ChaoxingAdapter({
      doc: document,
      url: examUrl,
      verifyTimeoutMs: 200,
      saveQuietMs: 0,
    });
    const result = await adapter.apply({
      questionId: q.id,
      fingerprint: q.fingerprint,
      targetOptionIds: ['O2'],
      clearExtra: true,
    });
    expect(result.ok).toBe(true);
    expect(result.actualServerKeys).toEqual(['A']);
    expect((document.querySelector('#answer1234567') as HTMLInputElement).value).toBe('A');
    expect(clicks).toBe(1);
    expect(document.querySelectorAll('.check_answer')).toHaveLength(1);
    expect(document.querySelectorAll('.check_answer')[0].textContent).toContain('SYN + ACK');
  });

  it('does not click when the correct option is already selected', async () => {
    const input = document.querySelector('#answer1234567') as HTMLInputElement;
    input.value = 'A';
    const rows = document.querySelectorAll('.answerBg');
    (rows[1].querySelector('.answer_p') as HTMLElement).classList.add('check_answer');
    const paper = snapshotPaper(document, examUrl);
    const q = paper.questions[0];
    const adapter = new ChaoxingAdapter({
      doc: document,
      url: examUrl,
      verifyTimeoutMs: 200,
      saveQuietMs: 0,
    });
    const result = await adapter.apply({
      questionId: q.id,
      fingerprint: q.fingerprint,
      targetOptionIds: ['O2'],
      clearExtra: true,
    });
    expect(result.ok).toBe(true);
    expect(clicks).toBe(0);
  });

  it('aborts when the question fingerprint changed', async () => {
    const paper = snapshotPaper(document, examUrl);
    const q = paper.questions[0];
    const adapter = new ChaoxingAdapter({
      doc: document,
      url: examUrl,
      verifyTimeoutMs: 200,
      saveQuietMs: 0,
    });
    (document.querySelector('.mark_name') as HTMLElement).textContent = '完全不同的题目';
    const result = await adapter.apply({
      questionId: q.id,
      fingerprint: q.fingerprint,
      targetOptionIds: ['O2'],
      clearExtra: true,
    });
    expect(result.ok).toBe(false);
    expect(result.failureCode).toBe('QUESTION_CHANGED');
    expect(clicks).toBe(0);
  });

  it('dry-run reports the plan without clicking', () => {
    const paper = snapshotPaper(document, examUrl);
    const q = paper.questions[0];
    const adapter = new ChaoxingAdapter({ doc: document, url: examUrl });
    const plan = adapter.dryRun({
      questionId: q.id,
      fingerprint: q.fingerprint,
      targetOptionIds: ['O2'],
      clearExtra: true,
    });
    expect(plan.ok).toBe(true);
    expect(plan.targetServerKeys).toEqual(['A']);
    expect(plan.addOptionIds).toEqual(['O2']);
    expect(clicks).toBe(0);
  });
});
