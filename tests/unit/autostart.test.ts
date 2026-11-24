import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CONFIG } from '@cx/core';
import type { ExamPaper, PageAdapter, QuestionAnswer } from '@cx/core';
import { LocalWorkbenchController } from '../../packages/ui/src/state/workbench-controller';

function paper(currentNumber: number): ExamPaper {
  return {
    id: 'paper-auto',
    title: '自动预取测试',
    url: 'https://mooc1-api.chaoxing.com/exam-ans/exam/test',
    mode: 'single',
    canPreview: false,
    capturedAt: Date.now(),
    totalCount: 5,
    currentNumber,
    answeredCount: 2,
    questionIndex: [
      { number: 1, qid: '111', answered: true, current: false },
      { number: 2, qid: '222', answered: true, current: false },
      { number: 3, qid: '333', answered: false, current: currentNumber === 3 },
      { number: 4, qid: '444', answered: false, current: false },
      { number: 5, qid: '555', answered: false, current: currentNumber === 5 },
    ],
    questions: [
      {
        id: `q${currentNumber}`,
        qid: String(currentNumber).repeat(3),
        number: currentNumber,
        type: 'single',
        typeLabel: '单选题',
        stem: `第 ${currentNumber} 题`,
        options: [
          { id: 'O1', displayLabel: 'A', serverKey: 'A', text: '甲', keyConfidence: 'high', selectedDom: false, selectedServer: false },
          { id: 'O2', displayLabel: 'B', serverKey: 'B', text: '乙', keyConfidence: 'high', selectedDom: false, selectedServer: false },
        ],
        inputs: [],
        images: [],
        serverValue: '',
        domValue: '',
        answered: false,
        fingerprint: `fp-${currentNumber}`,
      },
    ],
  };
}

function makeAdapter(currentNumber: number) {
  const applied: string[] = [];
  const jumps: Array<[number, string | undefined]> = [];
  const adapter: PageAdapter = {
    detect: () => ({ mode: 'single', title: '自动预取测试', canPreview: false, questionCount: 1 }),
    snapshotPaper: () => paper(currentNumber),
    snapshotQuestion: () => paper(currentNumber).questions[0],
    readState: () => null,
    apply: async (plan) => {
      applied.push(plan.questionId);
      return { ok: true, questionId: plan.questionId, actualServerKeys: ['A'], actualOptionIds: ['O1'], clicks: ['O1'] };
    },
    nextQuestion: async () => ({ ok: true, end: false }),
    enterPreview: async () => false,
    getTimer: () => null,
    highlightQuestion: () => {},
    jumpToQuestion: async (number, qid) => {
      jumps.push([number, qid]);
      return { ok: true, end: false };
    },
  };
  return { adapter, applied, jumps };
}

function makeEngine() {
  const solvePaper = vi.fn(async (input: ExamPaper, onAnswer: (answer: QuestionAnswer) => void) => {
    const answers = input.questions.map((q) => ({
      questionId: q.id,
      optionIds: ['O1'],
      serverKeys: ['A'],
      answerText: '',
      confidence: 0.9,
      reason: 'mock',
      stage: 'fast' as const,
      risk: false,
      riskReasons: [],
    }));
    answers.forEach(onAnswer);
    return answers;
  });
  return { solvePaper } as any;
}

describe('auto prefetch on exam open', () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
  });

  it('jumps to the first unanswered question and prefetches without applying', async () => {
    const { adapter, applied, jumps } = makeAdapter(5);
    const engine = makeEngine();
    const controller = new LocalWorkbenchController(adapter, engine, { config: DEFAULT_CONFIG });
    await controller.init();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(jumps[0]).toEqual([3, '333']);
    expect(applied).toHaveLength(0);
    controller.dispose();
  });

  it('stays put when already on the first unanswered question', async () => {
    const { adapter, applied, jumps } = makeAdapter(3);
    const engine = makeEngine();
    const controller = new LocalWorkbenchController(adapter, engine, { config: DEFAULT_CONFIG });
    await controller.init();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(jumps).toHaveLength(0);
    expect(engine.solvePaper).toHaveBeenCalled();
    expect(applied).toHaveLength(0);
    controller.dispose();
  });

  it('does not prefetch when autoStart is off', async () => {
    const { adapter } = makeAdapter(3);
    const engine = makeEngine();
    const controller = new LocalWorkbenchController(adapter, engine, {
      config: { ...DEFAULT_CONFIG, ui: { ...DEFAULT_CONFIG.ui, autoStart: false } },
    });
    await controller.init();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(engine.solvePaper).not.toHaveBeenCalled();
    controller.dispose();
  });
});
