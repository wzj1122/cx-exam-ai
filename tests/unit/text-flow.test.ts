import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { AnswerEngine } from '@cx/core';
import type { ProviderConfig } from '@cx/core';
import { ChaoxingAdapter, snapshotPaper } from '@cx/chaoxing';

const fixture = readFileSync(resolve(process.cwd(), 'tests/fixtures/exam-text.html'), 'utf8');
const examUrl = 'https://mooc1.chaoxing.com/exam/test/reVersionTestStartNew?tId=3';
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

describe('text question flow', () => {
  it('writes a text answer into the textarea', async () => {
    document.body.innerHTML = fixture;
    const paper = snapshotPaper(document, examUrl);
    const engine = new AnswerEngine({
      providers: [provider],
      caller: async () => ({
        text: '{"optionIds":[],"text":"80","confidence":0.9,"reason":"HTTP 默认端口"}',
        ms: 5,
        raw: {},
      }),
    });
    const [answer] = await engine.solvePaper(paper, () => {});
    expect(answer.answerText).toBe('80');
    const adapter = new ChaoxingAdapter({ doc: document, url: examUrl, verifyTimeoutMs: 200, saveQuietMs: 0 });
    const result = await adapter.apply({
      questionId: paper.questions[0].id,
      fingerprint: paper.questions[0].fingerprint,
      targetOptionIds: [],
      textAnswer: answer.answerText,
      clearExtra: true,
    });
    expect(result.ok).toBe(true);
    expect((document.querySelector('textarea') as HTMLTextAreaElement).value).toBe('80');
  });

  it('treats a UEditor hidden zero as unanswered and syncs the editor', async () => {
    document.body.innerHTML = `
      <div class="questionLi" data="4444444">
        <input type="hidden" name="type4444444" value="2" />
        <input type="hidden" id="answer4444444" value="0" />
        <h3 class="mark_name">3. 1+2=____。</h3>
        <div class="edui-editor">
          <textarea id="answerEditor44444441"></textarea>
        </div>
      </div>`;
    const hidden = document.querySelector('#answer4444444') as HTMLInputElement;
    (window as any).UE = {
      getEditor(id: string) {
        return {
          body: {},
          setContent(html: string) {
            (window as any).__editorHtml = html;
          },
          sync() {
            hidden.value = '3';
          },
        };
      },
    };
    const paper = snapshotPaper(document, examUrl);
    expect(paper.questions[0].answered).toBe(false);
    expect(paper.questions[0].inputs).toHaveLength(1);
    const adapter = new ChaoxingAdapter({ doc: document, url: examUrl, verifyTimeoutMs: 200, saveQuietMs: 0 });
    const result = await adapter.apply({
      questionId: paper.questions[0].id,
      fingerprint: paper.questions[0].fingerprint,
      targetOptionIds: [],
      textAnswer: '3',
      clearExtra: true,
    });
    expect(result.ok).toBe(true);
    expect(hidden.value).toBe('3');
    delete (window as any).UE;
  });
});
