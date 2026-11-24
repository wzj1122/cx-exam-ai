import { describe, expect, it } from 'vitest';
import { ChaoxingAdapter, snapshotPaper } from '@cx/chaoxing';

describe('question card jump', () => {
  it('clicks the requested answer-card slot and waits for the qid change', async () => {
    document.body.innerHTML = `
      <div id="topicNumberScroll">
        <li data-asq="1111111" class="current">1</li>
        <li data-asq="2222222">2</li>
      </div>
      <div class="questionLi" data="1111111">
        <input type="hidden" name="type1111111" value="0" />
        <h3 class="mark_name">1. 第一题</h3>
        <ul class="stem_answer">
          <li><a class="answerBg"><span class="num_option" data="A">A</span><div class="answer_p">甲</div></a></li>
        </ul>
      </div>`;
    const root = document.querySelector('.questionLi') as HTMLElement;
    document.querySelector('li[data-asq="2222222"]')?.addEventListener('click', () => {
      root.setAttribute('data', '2222222');
      root.querySelector('.mark_name')!.textContent = '2. 第二题';
      document.querySelectorAll('#topicNumberScroll li').forEach((li) => li.classList.remove('current'));
      document.querySelector('li[data-asq="2222222"]')?.classList.add('current');
    });
    const paper = snapshotPaper(document, 'https://mooc1-api.chaoxing.com/exam-ans/exam/test?start=0');
    const adapter = new ChaoxingAdapter({ doc: document, url: 'https://mooc1-api.chaoxing.com/exam-ans/exam/test?start=0', verifyTimeoutMs: 200 });
    const result = await adapter.jumpToQuestion(2, '2222222');
    expect(result.ok).toBe(true);
    expect(document.querySelector('.questionLi')?.getAttribute('data')).toBe('2222222');
    expect(paper.questionIndex).toHaveLength(2);
  });
});
