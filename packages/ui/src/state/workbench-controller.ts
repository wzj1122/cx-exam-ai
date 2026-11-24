import type {
  AnswerEngine,
  AppConfig,
  ApplyResult,
  ExamPaper,
  PageAdapter,
  QuestionAnswer,
  QuestionSnapshot,
} from '@cx/core';

export type QuestionStatus =
  | 'idle'
  | 'solving'
  | 'ready'
  | 'filling'
  | 'filled'
  | 'manual'
  | 'failed';

export interface VerifyDiff {
  questionId: string;
  number: number;
  expected: string;
  actual: string;
}

export interface WorkbenchState {
  ready: boolean;
  paper: ExamPaper | null;
  answers: Record<string, QuestionAnswer>;
  status: Record<string, QuestionStatus>;
  selectedId: string;
  fillIds: string[];
  logs: string[];
  running: boolean;
  previewCountdown: number | null;
  verifyDiffs: VerifyDiff[];
  lastError: string;
}

export interface WorkbenchController {
  getState(): WorkbenchState;
  subscribe(listener: () => void): () => void;
  init(): Promise<void>;
  dispose(): void;
  solveAll(): Promise<void>;
  solveOne(questionId: string): Promise<void>;
  applyAll(): Promise<void>;
  applyOne(questionId: string): Promise<void>;
  applyAndNext?(questionId: string): Promise<void>;
  runSingle(): Promise<void>;
  runAll(): Promise<void>;
  jumpToQuestion?(number: number, qid?: string): Promise<void>;
  setSelected(questionId: string): void;
  setAnswerOption(questionId: string, optionIds: string[]): void;
  setAnswerText(questionId: string, text: string): void;
  toggleFill(questionId: string): void;
  setFillIds(ids: string[]): void;
  enterPreview(): Promise<void>;
  cancelPreview?(): void;
  nextQuestion(): Promise<void>;
  verifyAll(): Promise<void>;
  exportDiagnostics(): string;
}

export interface LocalControllerOptions {
  config: AppConfig;
  onLog?: (message: string) => void;
}

function emptyState(): WorkbenchState {
  return {
    ready: false,
    paper: null,
    answers: {},
    status: {},
    selectedId: '',
    fillIds: [],
    logs: [],
    running: false,
    previewCountdown: null,
    verifyDiffs: [],
    lastError: '',
  };
}

const AUTO_RUN_KEY = 'cx-exam-ai:v2:auto-run';
const PENDING_RUN_KEY = 'cx-exam-ai:v2:pending-run';
const AUTO_NAV_KEY = 'cx-exam-ai:v2:auto-nav';
const ANSWER_MEMORY_PREFIX = 'cx-exam-ai:v2:answer-memory:';

interface AutoRunState {
  paperId: string;
  processed: string[];
  at: number;
}

interface PendingRunState {
  paperId: string;
  mode: 'single' | 'all';
  at: number;
}

interface CachedAnswer {
  fingerprint: string;
  answer: QuestionAnswer;
}

function readAutoRun(paperId: string): AutoRunState | null {
  try {
    const raw = sessionStorage.getItem(AUTO_RUN_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as AutoRunState;
    if (!value || value.paperId !== paperId) return null;
    if (Date.now() - Number(value.at || 0) > 30 * 60_000) return null;
    return { ...value, processed: Array.isArray(value.processed) ? value.processed : [] };
  } catch {
    return null;
  }
}

function saveAutoRun(value: AutoRunState): void {
  try {
    sessionStorage.setItem(AUTO_RUN_KEY, JSON.stringify({ ...value, at: Date.now() }));
  } catch {
    // ignore
  }
}

function clearAutoRun(): void {
  try {
    sessionStorage.removeItem(AUTO_RUN_KEY);
  } catch {
    // ignore
  }
}

function readPendingRun(paperId: string): PendingRunState | null {
  try {
    const raw = sessionStorage.getItem(PENDING_RUN_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as PendingRunState;
    if (!value || value.paperId !== paperId) return null;
    if (Date.now() - Number(value.at || 0) > 10 * 60_000) return null;
    return value;
  } catch {
    return null;
  }
}

function savePendingRun(paperId: string, mode: 'single' | 'all'): void {
  try {
    sessionStorage.setItem(PENDING_RUN_KEY, JSON.stringify({ paperId, mode, at: Date.now() }));
  } catch {
    // ignore
  }
}

function shouldAutoNavigate(paperId: string, targetQid: string): boolean {
  try {
    const raw = sessionStorage.getItem(AUTO_NAV_KEY);
    if (raw) {
      const value = JSON.parse(raw) as { paperId: string; target: string; at: number };
      if (value.paperId === paperId && value.target === targetQid && Date.now() - Number(value.at || 0) < 15_000) {
        return false;
      }
    }
    sessionStorage.setItem(AUTO_NAV_KEY, JSON.stringify({ paperId, target: targetQid, at: Date.now() }));
    return true;
  } catch {
    return true;
  }
}

function clearPendingRun(): void {
  try {
    sessionStorage.removeItem(PENDING_RUN_KEY);
  } catch {
    // ignore
  }
}

function readAnswerMemory(paperId: string): Record<string, CachedAnswer> {
  try {
    const raw = sessionStorage.getItem(ANSWER_MEMORY_PREFIX + paperId);
    if (!raw) return {};
    const value = JSON.parse(raw);
    return value && typeof value === 'object' ? value : {};
  } catch {
    return {};
  }
}

function saveAnswerMemory(paperId: string, qid: string, fingerprint: string, answer: QuestionAnswer): void {
  try {
    const memory = readAnswerMemory(paperId);
    memory[qid] = { fingerprint, answer };
    sessionStorage.setItem(ANSWER_MEMORY_PREFIX + paperId, JSON.stringify(memory));
  } catch {
    // ignore
  }
}

export class LocalWorkbenchController implements WorkbenchController {
  private state: WorkbenchState = emptyState();
  private readonly listeners = new Set<() => void>();
  private previewTimer: ReturnType<typeof setInterval> | null = null;
  private timerHandle: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly adapter: PageAdapter,
    private engine: AnswerEngine,
    private readonly options: LocalControllerOptions,
  ) {}

  setEngine(engine: AnswerEngine): void {
    this.engine = engine;
  }

  updateConfig(config: AppConfig): void {
    this.options.config = config;
  }

  getState(): WorkbenchState {
    return this.state;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(patch: Partial<WorkbenchState>): void {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((listener) => listener());
  }

  private log(message: string): void {
    const time = new Date().toLocaleTimeString('zh-CN', { hour12: false });
    const logs = [...this.state.logs, `[${time}] ${message}`].slice(-300);
    this.emit({ logs });
    this.options.onLog?.(message);
  }

  async init(): Promise<void> {
    const info = this.adapter.detect();
    if (!info) {
      this.emit({ lastError: '当前页面不是受支持的考试页' });
      return;
    }
    const paper = this.adapter.snapshotPaper();
    if (!paper.questions.length) {
      this.emit({ lastError: '没有抓到题目，请确认页面已加载完成' });
      return;
    }
    const memory = readAnswerMemory(paper.id);
    const answers: Record<string, QuestionAnswer> = {};
    const status: Record<string, QuestionStatus> = {};
    const fillIds: string[] = [];
    for (const q of paper.questions) {
      const cached = memory[q.id];
      if (cached && cached.fingerprint === q.fingerprint) {
        answers[q.id] = cached.answer;
        status[q.id] = 'ready';
        if (!(cached.answer.risk && this.options.config.ui.riskDefaultExcluded)) fillIds.push(q.id);
      } else {
        status[q.id] = 'idle';
        fillIds.push(q.id);
      }
    }
    this.emit({
      ready: true,
      paper,
      selectedId: paper.questions[0].id,
      fillIds,
      answers,
      status,
      lastError: '',
    });
    this.startTimer();
    this.log(`已载入 ${paper.questions.length} 道题 · ${paper.mode === 'preview' ? '整卷预览' : '单题模式'}`);
    if (paper.mode === 'single' && paper.canPreview && this.options.config.ui.autoEnterPreview) {
      this.startPreviewCountdown();
    }
    const auto = readAutoRun(paper.id);
    const pending = readPendingRun(paper.id);
    const currentQid = paper.questions[0]?.id || '';
    if (auto) {
      if (auto.processed.includes(currentQid)) {
        this.log('自动连答：当前题已处理，继续下一题');
        void this.nextQuestion();
      } else {
        this.log('自动连答：继续处理当前题');
        void this.runAutoStep(auto);
      }
    } else {
      const first = this.firstUnanswered();
      const current = paper.questions[0];
      if (
        !pending &&
        this.options.config.ui.autoStart !== false &&
        first &&
        current &&
        first.qid !== current.qid &&
        shouldAutoNavigate(paper.id, first.qid)
      ) {
        this.log(`自动预取：跳到最前面的未答题 第 ${first.number} 题`);
        void this.jumpToQuestion(first.number, first.qid);
        return;
      }
      // 打开页面先后台预取/缓存当前可见题；不自动点击、不自动翻页。
      const prefetch = this.options.config.ui.autoStart !== false ? this.solveAll() : Promise.resolve();
      void prefetch.then(() => this.continuePending(pending));
    }
  }

  dispose(): void {
    if (this.previewTimer) clearInterval(this.previewTimer);
    this.previewTimer = null;
    if (this.timerHandle) clearInterval(this.timerHandle);
    this.timerHandle = null;
    this.listeners.clear();
  }

  private startTimer(): void {
    if (this.timerHandle) clearInterval(this.timerHandle);
    this.timerHandle = setInterval(() => {
      if (!this.state.paper) return;
      const timer = this.adapter.getTimer();
      if (!timer) return;
      if (
        this.state.paper.timer?.text !== timer.text ||
        this.state.paper.timer?.remainingSec !== timer.remainingSec
      ) {
        this.emit({ paper: { ...this.state.paper, timer } });
      }
    }, 1000);
  }

  private firstUnanswered() {
    return (this.state.paper?.questionIndex || []).find((item) => !item.answered) || null;
  }

  private async continuePending(pending: PendingRunState | null): Promise<void> {
    if (!pending || !this.state.paper) return;
    const current = this.state.paper.questions[0];
    const first = this.firstUnanswered();
    if (!first) {
      clearPendingRun();
      this.log('这一页已经全部作答');
      return;
    }
    if (!current || current.qid !== first.qid) {
      clearPendingRun();
      this.log('未能停到最前面的未答题，已取消自动运行');
      return;
    }
    clearPendingRun();
    if (pending.mode === 'all') await this.runAll();
    else await this.runSingle();
  }

  private startPreviewCountdown(): void {
    if (this.previewTimer) clearInterval(this.previewTimer);
    let remaining = 3;
    this.emit({ previewCountdown: remaining });
    this.previewTimer = setInterval(() => {
      remaining -= 1;
      if (remaining <= 0) {
        if (this.previewTimer) clearInterval(this.previewTimer);
        this.previewTimer = null;
        this.emit({ previewCountdown: null });
        void this.enterPreview();
      } else {
        this.emit({ previewCountdown: remaining });
      }
    }, 1000);
  }

  cancelPreview(): void {
    if (this.previewTimer) clearInterval(this.previewTimer);
    this.previewTimer = null;
    this.emit({ previewCountdown: null });
    this.log('已取消自动进入整卷预览');
  }

  private markStatus(questionId: string, status: QuestionStatus): void {
    this.emit({ status: { ...this.state.status, [questionId]: status } });
  }

  async solveAll(): Promise<void> {
    if (!this.state.paper) return;
    if (this.state.running) return;
    const missing = this.state.paper.questions.filter((q) => !this.state.answers[q.id]);
    if (!missing.length) {
      this.log('答案已从本页缓存读取，无需重新请求');
      return;
    }
    this.emit({ running: true });
    for (const q of missing) this.markStatus(q.id, 'solving');
    try {
      await this.engine.solvePaper({ ...this.state.paper, questions: missing }, (answer) => {
        this.acceptAnswer(answer);
      });
      this.log('首轮答案已生成，风险题默认不勾选');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.log(`答题失败：${message}`);
      this.emit({ lastError: message });
    } finally {
      this.emit({ running: false });
    }
  }

  async solveOne(questionId: string): Promise<void> {
    const q = this.state.paper?.questions.find((item) => item.id === questionId);
    if (!q) return;
    this.markStatus(questionId, 'solving');
    try {
      await this.engine.solvePaper(
        { ...this.state.paper!, questions: [q] },
        (answer) => this.acceptAnswer(answer),
        { questionIds: [q.id], force: true },
      );
    } catch (error) {
      this.log(`第 ${q.number} 题重新判定失败：${error instanceof Error ? error.message : String(error)}`);
      this.markStatus(questionId, 'failed');
    }
  }

  private acceptAnswer(answer: QuestionAnswer): void {
    const risk = answer.risk || !answer.optionIds.length && !answer.answerText.trim();
    const nextAnswer = { ...answer, risk };
    const q = this.state.paper?.questions.find((item) => item.id === answer.questionId);
    if (q && this.state.paper) {
      saveAnswerMemory(this.state.paper.id, q.id, q.fingerprint, nextAnswer);
    }
    const answers = { ...this.state.answers, [answer.questionId]: nextAnswer };
    const fillIds = this.state.fillIds.includes(answer.questionId)
      ? this.state.fillIds
      : risk
        ? this.state.fillIds
        : [...this.state.fillIds, answer.questionId];
    const filtered = this.options.config.ui.riskDefaultExcluded && risk
      ? fillIds.filter((id) => id !== answer.questionId)
      : fillIds;
    this.emit({ answers, fillIds: filtered });
    this.markStatus(answer.questionId, 'ready');
  }

  private planFor(q: QuestionSnapshot, answer: QuestionAnswer) {
    return {
      questionId: q.id,
      fingerprint: q.fingerprint,
      targetOptionIds: answer.optionIds,
      textAnswer: answer.answerText,
      clearExtra: this.options.config.apply.clearExtra,
    };
  }

  async applyAll(): Promise<void> {
    if (!this.state.paper) return;
    const targets = this.state.paper.questions.filter((q) => this.state.fillIds.includes(q.id));
    if (!targets.length) {
      this.log('没有勾选要填写的题目');
      return;
    }
    this.emit({ running: true });
    for (const q of targets) {
      await this.applyQuestion(q);
    }
    this.emit({ running: false });
  }

  async applyOne(questionId: string): Promise<void> {
    const q = this.state.paper?.questions.find((item) => item.id === questionId);
    if (!q) return;
    await this.applyQuestion(q);
  }

  async applyAndNext(questionId: string): Promise<void> {
    const q = this.state.paper?.questions.find((item) => item.id === questionId);
    if (!q) return;
    await this.applyQuestion(q);
    if (this.state.status[questionId] === 'filled') {
      await this.nextQuestion();
    }
  }

  async runSingle(): Promise<void> {
    const paper = this.state.paper;
    const current = paper?.questions[0];
    const first = this.firstUnanswered();
    if (paper && !first) {
      this.log('全部题目都已作答');
      return;
    }
    if (paper && current && first && first.qid !== current.qid) {
      savePendingRun(paper.id, 'single');
      this.log(`答一题：先跳到最前面的未答题 第 ${first.number} 题`);
      await this.jumpToQuestion(first.number, first.qid);
      return;
    }
    const q = this.state.paper?.questions.find((item) => item.id === this.state.selectedId) ||
      this.state.paper?.questions[0];
    if (!q) return;
    if (!this.state.answers[q.id]) {
      await this.solveOne(q.id);
    }
    const answer = this.state.answers[q.id];
    if (!answer) return;
    if (answer.risk && this.options.config.ui.riskDefaultExcluded) {
      this.log(`第 ${q.number} 题是风险题，单击运行不会自动填写`);
      return;
    }
    await this.applyQuestion(q);
    if (this.state.status[q.id] === 'filled' && this.state.paper?.mode === 'single') {
      await this.nextQuestion();
    }
  }

  async runAll(): Promise<void> {
    const paper = this.state.paper;
    if (!paper) return;
    const current = paper.questions[0];
    const first = this.firstUnanswered();
    if (!first) {
      this.log('全部题目都已作答');
      return;
    }
    if (paper.mode === 'single' && current && first && first.qid !== current.qid) {
      savePendingRun(paper.id, 'all');
      this.log(`全部填写：先跳到最前面的未答题 第 ${first.number} 题`);
      await this.jumpToQuestion(first.number, first.qid);
      return;
    }
    if (paper.mode === 'preview') {
      await this.solveAll();
      await this.applyAll();
      return;
    }
    if (!current) return;
    const auto = { paperId: paper.id, processed: [], at: Date.now() };
    saveAutoRun(auto);
    this.log('自动连答启动：逐题判定 → 填写 → 下一题（不交卷）');
    await this.runAutoStep(auto);
  }

  async jumpToQuestion(number: number, qid?: string): Promise<void> {
    if (!this.adapter.jumpToQuestion) return;
    clearAutoRun();
    const result = await this.adapter.jumpToQuestion(number, qid);
    if (!result.ok) {
      this.log(result.message || '跳题失败');
      return;
    }
    const paper = this.adapter.snapshotPaper();
    this.emit({
      paper,
      selectedId: paper.questions[0]?.id || '',
      answers: {},
      fillIds: paper.questions.map((q) => q.id),
      status: Object.fromEntries(paper.questions.map((q) => [q.id, 'idle' as QuestionStatus])),
      verifyDiffs: [],
    });
    this.startTimer();
    void this.solveAll();
  }

  private async runAutoStep(auto: AutoRunState): Promise<void> {
    const paper = this.state.paper;
    const q = paper?.questions[0];
    if (!paper || !q) return;
    if (auto.processed.includes(q.id)) {
      await this.nextQuestion();
      return;
    }
    if (!this.state.answers[q.id]) await this.solveOne(q.id);
    const answer = this.state.answers[q.id];
    if (!answer) {
      clearAutoRun();
      this.log('自动连答停止：当前题没有拿到答案');
      return;
    }
    if (answer.risk && this.options.config.ui.riskDefaultExcluded) {
      this.log(`自动连答跳过第 ${q.number} 题（风险题），继续下一题`);
      auto.processed.push(q.id);
      saveAutoRun(auto);
      await this.nextQuestion();
      return;
    }
    await this.applyQuestion(q);
    if (this.state.status[q.id] !== 'filled') {
      clearAutoRun();
      this.log('自动连答停止：当前题没有写入成功');
      return;
    }
    auto.processed.push(q.id);
    saveAutoRun(auto);
    await this.nextQuestion();
  }

  private async applyQuestion(q: QuestionSnapshot): Promise<void> {
    if (this.previewTimer) this.cancelPreview();
    const answer = this.state.answers[q.id];
    if (!answer) {
      this.log(`第 ${q.number} 题还没有答案`);
      return;
    }
    if (!answer.optionIds.length && !String(answer.answerText || '').trim()) {
      this.log(`第 ${q.number} 题答案为空，已跳过`);
      this.markStatus(q.id, 'manual');
      return;
    }
    this.markStatus(q.id, 'filling');
    try {
      const result: ApplyResult = await this.adapter.apply(this.planFor(q, answer));
      if (result.ok) {
        this.markStatus(q.id, 'filled');
        this.log(`第 ${q.number} 题已填写并校验通过`);
        const fresh = this.adapter.snapshotPaper();
        if (this.state.paper) {
          this.emit({
            paper: {
              ...this.state.paper,
              answeredCount: fresh.answeredCount ?? this.state.paper.answeredCount,
              totalCount: fresh.totalCount ?? this.state.paper.totalCount,
              currentNumber: fresh.currentNumber ?? this.state.paper.currentNumber,
              timer: fresh.timer ?? this.state.paper.timer,
            },
          });
        }
      } else {
        this.markStatus(q.id, result.failureCode === 'MANUAL_REQUIRED' ? 'manual' : 'failed');
        this.log(`第 ${q.number} 题填写失败：${result.message || result.failureCode}`);
        this.emit({ lastError: result.message || String(result.failureCode) });
      }
    } catch (error) {
      this.markStatus(q.id, 'failed');
      this.log(`第 ${q.number} 题填写异常：${error instanceof Error ? error.message : String(error)}`);
    }
  }

  setSelected(questionId: string): void {
    this.emit({ selectedId: questionId });
    this.adapter.highlightQuestion(questionId);
  }

  setAnswerOption(questionId: string, optionIds: string[]): void {
    const current = this.state.answers[questionId];
    if (!current) return;
    this.emit({
      answers: {
        ...this.state.answers,
        [questionId]: { ...current, optionIds, risk: false, riskReasons: [] },
      },
      status: { ...this.state.status, [questionId]: 'ready' },
    });
  }

  setAnswerText(questionId: string, text: string): void {
    const current = this.state.answers[questionId];
    if (!current) return;
    this.emit({
      answers: {
        ...this.state.answers,
        [questionId]: { ...current, answerText: text, risk: false, riskReasons: [] },
      },
      status: { ...this.state.status, [questionId]: 'ready' },
    });
  }

  toggleFill(questionId: string): void {
    const has = this.state.fillIds.includes(questionId);
    this.emit({
      fillIds: has
        ? this.state.fillIds.filter((id) => id !== questionId)
        : [...this.state.fillIds, questionId],
    });
  }

  setFillIds(ids: string[]): void {
    this.emit({ fillIds: ids });
  }

  async enterPreview(): Promise<void> {
    if (this.previewTimer) clearInterval(this.previewTimer);
    this.previewTimer = null;
    this.emit({ previewCountdown: null });
    const ok = await this.adapter.enterPreview();
    if (!ok) {
      this.log('没有找到整卷预览入口，或进入预览失败');
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 700));
    const paper = this.adapter.snapshotPaper();
    this.emit({
      paper,
      selectedId: paper.questions[0]?.id || '',
      answers: {},
      fillIds: paper.questions.map((q) => q.id),
      status: Object.fromEntries(paper.questions.map((q) => [q.id, 'idle' as QuestionStatus])),
      verifyDiffs: [],
    });
    this.log(`已进入整卷预览，载入 ${paper.questions.length} 道题`);
    void this.solveAll();
  }

  async nextQuestion(): Promise<void> {
    const result = await this.adapter.nextQuestion();
    if (!result.ok) {
      if (result.end) clearAutoRun();
      this.log(result.end ? '已经到最后一题' : `翻页失败：${result.message || '未知原因'}`);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 450));
    const paper = this.adapter.snapshotPaper();
    this.emit({
      paper,
      selectedId: paper.questions[0]?.id || '',
      answers: {},
      fillIds: paper.questions.map((q) => q.id),
      status: Object.fromEntries(paper.questions.map((q) => [q.id, 'idle' as QuestionStatus])),
    });
    void this.solveAll();
  }

  async verifyAll(): Promise<void> {
    if (!this.state.paper) return;
    const fresh = this.adapter.snapshotPaper();
    const diffs: VerifyDiff[] = [];
    for (const q of fresh.questions) {
      const answer = this.state.answers[q.id];
      if (!answer) continue;
      const expected = answer.serverKeys.slice().sort().join('');
      const actual = q.options
        .filter((o) => o.selectedServer)
        .map((o) => o.serverKey)
        .sort()
        .join('');
      if (expected !== actual) {
        diffs.push({ questionId: q.id, number: q.number, expected, actual });
      }
    }
    this.emit({ verifyDiffs: diffs });
    this.log(diffs.length ? `复核发现 ${diffs.length} 道题与页面答案不一致` : '复核通过：页面答案与本地答案一致');
  }

  exportDiagnostics(): string {
    const payload = {
      exportedAt: new Date().toISOString(),
      url: this.state.paper?.url || '',
      title: this.state.paper?.title || '',
      questions: (this.state.paper?.questions || []).map((q) => ({
        id: q.id,
        qid: q.qid,
        number: q.number,
        type: q.type,
        stem: q.stem,
        fingerprint: q.fingerprint,
        options: q.options.map((o) => ({
          id: o.id,
          displayLabel: o.displayLabel,
          serverKey: o.serverKey,
          text: o.text,
          keyConfidence: o.keyConfidence,
        })),
        serverValue: q.serverValue,
        answer: this.state.answers[q.id] || null,
        status: this.state.status[q.id] || 'idle',
      })),
      logs: this.state.logs,
      verifyDiffs: this.state.verifyDiffs,
    };
    return JSON.stringify(payload, null, 2).replace(/(sk-[A-Za-z0-9_-]{6})[A-Za-z0-9_-]+/g, '$1***');
  }
}
