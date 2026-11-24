import { hashString, normText, sleep, truncate } from '@cx/core';
import type { ExamPageInfo, ExamPaper, ExamTimer, QuestionIndexItem, QuestionSnapshot } from '@cx/core';
import { QUESTION_ROOT_SELECTOR } from './selectors';
import { snapshotQuestion } from './dom';

export function isExamUrl(url: string): boolean {
  return /\/exam|\/mooc2\/exam|reVersionTestStartNew|exam-ans|\/test\//i.test(url);
}

export function previewEntry(doc: Document = document): HTMLElement | null {
  const nodes = Array.from(doc.querySelectorAll('a,button,div,span,li')) as HTMLElement[];
  const pick = nodes.filter((el) => {
    const onclick = el.getAttribute('onclick') || '';
    const href = el.getAttribute('href') || '';
    const text = normText(el.textContent || '');
    return (
      /topreview|preview/i.test(onclick + href) ||
      /^(整卷预览|试卷预览|整卷)$/.test(text)
    );
  });
  return pick.find((el) => el.offsetParent !== null) || pick[0] || null;
}

export function nextButton(doc: Document = document): HTMLElement | null {
  const nodes = Array.from(doc.querySelectorAll('[onclick]')) as HTMLElement[];
  const exact = nodes.find((el) => /getTheNextQuestion\(\s*1\s*\)/.test(el.getAttribute('onclick') || ''));
  if (exact) return exact;
  return nodes.find(
    (el) =>
      /(下一题|下一頁|下一页|Next)/i.test(normText(el.textContent || '')) &&
      !/disabled|disabled="disabled"/i.test(el.className || ''),
  ) || null;
}

export function readTimer(doc: Document = document): ExamTimer | null {
  const timerText = normText(doc.querySelector('#timer, .mark_timeDiv')?.textContent || '');
  const timerMatch = /(\d{1,4})\s*'\s*(\d{2})\s*''?/.exec(timerText);
  if (timerMatch) {
    const remainingSec = Number(timerMatch[1]) * 60 + Number(timerMatch[2]);
    return { text: `${timerMatch[1]}'${timerMatch[2]}"`, remainingSec };
  }
  const text = normText(doc.body?.innerText || '');
  const match =
    /(?:剩余时间|考试时间|倒计时)[^\d]{0,12}(\d{1,2}:\d{2}(?::\d{2})?|\d{1,3}'\d{2}"?)/.exec(text) ||
    /(\d{1,3}'\d{2}")/.exec(text);
  if (!match) return null;
  const raw = match[1];
  let remainingSec: number | undefined;
  if (/^\d{1,2}:\d{2}(?::\d{2})?$/.test(raw)) {
    const parts = raw.split(':').map(Number);
    remainingSec = parts.length === 3 ? parts[0] * 3600 + parts[1] * 60 + parts[2] : parts[0] * 60 + parts[1];
  } else if (/^\d{1,3}'\d{2}"?$/.test(raw)) {
    const [min, sec] = raw.replace('"', '').split("'").map(Number);
    remainingSec = min * 60 + sec;
  }
  return { text: raw, remainingSec };
}

export function detectPage(doc: Document = document, url = location.href): ExamPageInfo | null {
  const roots = Array.from(doc.querySelectorAll(QUESTION_ROOT_SELECTOR));
  if (!roots.length || !isExamUrl(url)) return null;
  const mode = roots.length > 1 || /preview/i.test(url) ? 'preview' : 'single';
  const title =
    normText(doc.querySelector('.h2_subject, .examTitle, .testTitle, .exam-name, h1')?.textContent || '') ||
    normText(doc.title || '') ||
    '超星考试';
  return {
    mode,
    title: truncate(title, 120),
    canPreview: !!previewEntry(doc),
    questionCount: roots.length,
  };
}

export async function waitForExamPage(
  doc: Document = document,
  url = location.href,
  timeoutMs = 15_000,
): Promise<ExamPageInfo | null> {
  const deadline = Date.now() + Math.max(500, timeoutMs);
  while (Date.now() < deadline) {
    const info = detectPage(doc, url);
    if (info) return info;
    await sleep(300);
  }
  return detectPage(doc, url);
}

export function paperKey(doc: Document = document, url = location.href): string {
  try {
    const params = new URL(url).searchParams;
    const parts = [
      params.get('tId'),
      params.get('examId'),
      params.get('id'),
      params.get('examAnswerId'),
      params.get('courseId'),
    ].filter(Boolean);
    if (parts.length) return parts.join('_');
  } catch {
    // ignore
  }
  const title = normText(doc.title || '');
  return `${location.pathname}|${title}`;
}

export function snapshotPaper(doc: Document = document, url = location.href): ExamPaper {
  const info = detectPage(doc, url);
  const roots = Array.from(doc.querySelectorAll(QUESTION_ROOT_SELECTOR));
  const totalCount =
    Number(/题量\s*[:：]\s*(\d+)/.exec(doc.body?.innerText || '')?.[1]) ||
    doc.querySelectorAll('#topicNumberScroll li[data-asq]').length ||
    roots.length;
  const startMatch = /[?&]start=(\d+)/.exec(url);
  const currentNumber = startMatch ? Number(startMatch[1]) + 1 : 1;
  const questionIndex: QuestionIndexItem[] = Array.from(
    doc.querySelectorAll('#topicNumberScroll li[data-asq]'),
  ).map((li, index) => {
    const classes = String(li.getAttribute('class') || '').split(/\s+/);
    return {
      number: Number((li.textContent || '').trim()) || index + 1,
      qid: String(li.getAttribute('data-asq') || ''),
      answered: classes.includes('active'),
      current: classes.includes('current'),
    };
  });
  const answeredCount = questionIndex.filter((item) => item.answered).length;
  const resolvedMode = info?.mode || (roots.length > 1 ? 'preview' : 'single');
  const questions: QuestionSnapshot[] = roots.map((root, index) => snapshotQuestion(root, index, doc));
  questions.forEach((q, index) => {
    if (resolvedMode === 'single') {
      q.number = currentNumber;
    } else {
      q.number = index + 1;
    }
  });
  const seen = new Map<string, number>();
  questions.forEach((q) => {
    const count = seen.get(q.id) || 0;
    seen.set(q.id, count + 1);
    if (count > 0) {
      q.id = `${q.id}_${count + 1}`;
    }
  });
  return {
    id: paperKey(doc, url),
    title: info?.title || normText(doc.title || '') || '超星考试',
    url,
    mode: resolvedMode,
    questions,
    totalCount,
    currentNumber,
    answeredCount,
    questionIndex,
    canPreview: info?.canPreview ?? false,
    capturedAt: Date.now(),
    timer: readTimer(doc) || undefined,
  };
}

export function titleFingerprint(paper: ExamPaper): string {
  return hashString(`${paper.id}|${paper.title}|${paper.questions.length}`);
}
