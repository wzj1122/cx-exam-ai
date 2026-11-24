import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { snapshotPaper } from '@cx/chaoxing';

const fixture = readFileSync(resolve(process.cwd(), 'tests/fixtures/exam-random-options.html'), 'utf8');

const examUrl = 'https://mooc1.chaoxing.com/exam/test/reVersionTestStartNew?tId=1';

describe('Chaoxing extractor', () => {
  it('keeps display label and server data key separate', () => {
    document.body.innerHTML = fixture;
    const paper = snapshotPaper(document, examUrl);
    expect(paper.mode).toBe('single');
    expect(paper.questions).toHaveLength(1);
    const q = paper.questions[0];
    expect(q.qid).toBe('1234567');
    expect(q.type).toBe('single');
    expect(q.options.map((o) => [o.id, o.displayLabel, o.serverKey])).toEqual([
      ['O1', 'A', 'D'],
      ['O2', 'B', 'A'],
      ['O3', 'C', 'B'],
      ['O4', 'D', 'C'],
    ]);
    expect(q.options.map((o) => o.text)).toEqual(['SYN', 'SYN + ACK', 'ACK', 'FIN']);
    expect(q.options.every((o) => o.keyConfidence === 'high')).toBe(true);
  });

  it('maps a server value in data-key space back to option ids', () => {
    document.body.innerHTML = fixture;
    const input = document.querySelector('#answer1234567') as HTMLInputElement;
    input.value = 'A';
    const paper = snapshotPaper(document, examUrl);
    const q = paper.questions[0];
    expect(q.options.filter((o) => o.selectedServer).map((o) => o.id)).toEqual(['O2']);
    expect(q.answered).toBe(true);
  });

  it('treats judgement true/false as option keys', () => {
    document.body.innerHTML = `
      <div class="questionLi" data="7654321">
        <input type="hidden" name="type7654321" value="3" />
        <input type="hidden" id="answer7654321" value="true" />
        <h3 class="mark_name">2. HTTP 默认端口是 80。</h3>
        <ul class="stem_answer">
          <li><a class="answerBg"><span class="num_option" data="true">A</span><div class="answer_p">对</div></a></li>
          <li><a class="answerBg"><span class="num_option" data="false">B</span><div class="answer_p">错</div></a></li>
        </ul>
      </div>`;
    const paper = snapshotPaper(document, examUrl);
    const q = paper.questions[0];
    expect(q.type).toBe('judgement');
    expect(q.options.find((o) => o.selectedServer)?.displayLabel).toBe('A');
  });

  it('ignores the global #type field and uses the per-question type field', () => {
    document.body.innerHTML = `
      <input type="hidden" id="type" value="0" />
      <div class="questionLi" data="9999999">
        <input type="hidden" name="type9999999" value="1" />
        <h3 class="mark_name">15. 多选题</h3>
        <ul class="stem_answer">
          <li><a class="answerBg"><span class="num_option_dx" data="A">A</span><div class="answer_p">甲</div></a></li>
          <li><a class="answerBg"><span class="num_option_dx" data="B">B</span><div class="answer_p">乙</div></a></li>
        </ul>
      </div>`;
    const paper = snapshotPaper(document, examUrl);
    expect(paper.questions[0].type).toBe('multiple');
  });

  it('reads paper title, timer, total, current number and answered count from a single-question page', () => {
    document.body.innerHTML = `
      <h2 class="h2_subject">真机试卷</h2>
      <span id="timer">10' 05''</span>
      <div id="topicNumberScroll">
        <li data-asq="1111111" class="active">1</li>
        <li data-asq="2222222" class="current">2</li>
      </div>
      <div class="questionLi" data="2222222">
        <input type="hidden" name="type2222222" value="0" />
        <h3 class="mark_name">2. 当前题</h3>
        <ul class="stem_answer">
          <li><a class="answerBg"><span class="num_option" data="A">A</span><div class="answer_p">甲</div></a></li>
        </ul>
      </div>`;
    const paper = snapshotPaper(document, 'https://mooc1-api.chaoxing.com/exam-ans/exam/test?start=1');
    expect(paper.title).toBe('真机试卷');
    expect(paper.timer?.text).toBe("10'05\"");
    expect(paper.timer?.remainingSec).toBe(605);
    expect(paper.totalCount).toBe(2);
    expect(paper.currentNumber).toBe(2);
    expect(paper.answeredCount).toBe(1);
    expect(paper.questionIndex).toHaveLength(2);
    expect(paper.questionIndex?.[0]).toMatchObject({ number: 1, qid: '1111111', answered: true, current: false });
    expect(paper.questionIndex?.[1]).toMatchObject({ number: 2, qid: '2222222', current: true });
    expect(paper.questions[0].number).toBe(2);
  });
});
