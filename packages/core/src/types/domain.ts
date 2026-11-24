export type QuestionType =
  | 'single'
  | 'multiple'
  | 'judgement'
  | 'completion'
  | 'unknown';

export type KeyConfidence = 'high' | 'low';

export type ExamMode = 'preview' | 'single';

export type AnswerStage = 'fast' | 'verify' | 'arbiter' | 'manual';

export interface OptionSnapshot {
  /** Internal stable id for this question: O1, O2, ... */
  id: string;
  /** What the page renders, e.g. A / B / 1 / 对. */
  displayLabel: string;
  /** What the page submits, e.g. span[data], choice_name, true/false. */
  serverKey: string;
  /** Option text as shown to the model and user. */
  text: string;
  keyConfidence: KeyConfidence;
  selectedDom: boolean;
  selectedServer: boolean;
  element?: HTMLElement;
  clickElement?: HTMLElement;
}

export interface InputSnapshot {
  index: number;
  kind: 'input' | 'textarea' | 'iframe';
  value: string;
  element?: HTMLElement;
}

export interface QuestionSnapshot {
  id: string;
  qid: string;
  number: number;
  type: QuestionType;
  typeLabel: string;
  stem: string;
  options: OptionSnapshot[];
  inputs: InputSnapshot[];
  images: string[];
  serverValue: string;
  domValue: string;
  answered: boolean;
  fingerprint: string;
  section?: string;
  root?: HTMLElement;
}

export interface ExamTimer {
  text: string;
  remainingSec?: number;
}

export interface ExamPaper {
  id: string;
  title: string;
  url: string;
  mode: ExamMode;
  questions: QuestionSnapshot[];
  /** Total questions in the whole paper (single-question mode only shows one DOM root). */
  totalCount?: number;
  /** Current question number in the whole paper (single-question mode). */
  currentNumber?: number;
  /** How many questions the page itself marks as answered. */
  answeredCount?: number;
  /** All question slots from the page answer card (single-question mode). */
  questionIndex?: QuestionIndexItem[];
  canPreview: boolean;
  capturedAt: number;
  timer?: ExamTimer;
}

export interface QuestionIndexItem {
  number: number;
  qid: string;
  answered: boolean;
  current: boolean;
}

export interface QuestionAnswer {
  questionId: string;
  optionIds: string[];
  serverKeys: string[];
  answerText: string;
  confidence: number;
  reason: string;
  stage: AnswerStage;
  risk: boolean;
  riskReasons: string[];
  raw?: string;
  timingMs?: number;
}

export interface ApplyPlan {
  questionId: string;
  fingerprint: string;
  /** Option ids that should end up selected. Adapter recomputes deltas live. */
  targetOptionIds: string[];
  /** Text answer for completion / short-answer questions. */
  textAnswer?: string;
  /** When true, remove options that are selected but not in targetOptionIds. */
  clearExtra: boolean;
}

export type ApplyFailureCode =
  | 'QUESTION_GONE'
  | 'QUESTION_CHANGED'
  | 'OPTION_MISSING'
  | 'OPTION_AMBIGUOUS'
  | 'NO_STATE_CHANGE'
  | 'SERVER_MISMATCH'
  | 'PAGE_ERROR'
  | 'MANUAL_REQUIRED';

export interface ApplyResult {
  ok: boolean;
  questionId: string;
  actualServerKeys: string[];
  actualOptionIds: string[];
  clicks: string[];
  failureCode?: ApplyFailureCode;
  message?: string;
  domSignature?: string;
}

export interface QuestionState {
  questionId: string;
  serverKeys: string[];
  serverValue: string;
  domOptionIds: string[];
  answered: boolean;
}

export interface NextQuestionResult {
  ok: boolean;
  end: boolean;
  message?: string;
  url?: string;
}

export interface ExamPageInfo {
  mode: ExamMode;
  title: string;
  canPreview: boolean;
  questionCount: number;
}

export interface PageAdapter {
  detect(): ExamPageInfo | null;
  snapshotPaper(): ExamPaper;
  snapshotQuestion(questionId: string): QuestionSnapshot | null;
  readState(questionId: string): QuestionState | null;
  apply(plan: ApplyPlan): Promise<ApplyResult>;
  nextQuestion(): Promise<NextQuestionResult>;
  enterPreview(): Promise<boolean>;
  jumpToQuestion?(number: number, qid?: string): Promise<NextQuestionResult>;
  getTimer(): ExamTimer | null;
  highlightQuestion(questionId: string): void;
}

export interface ProviderConfig {
  id: string;
  label: string;
  baseURL: string;
  apiKey: string;
  model: string;
  apiStyle: 'openai' | 'anthropic' | 'gemini';
  role: 'fast' | 'verify' | 'vision' | 'both';
  weight: number;
  temperature: number;
  maxTokens?: number;
  timeoutMs?: number;
  vision?: boolean;
}

export interface EngineConfig {
  batchSize: number;
  batchChars: number;
  concurrency: number;
  requestTimeoutMs: number;
  questionTimeoutMs: number;
  verifyThreshold: number;
  maxVerify: number;
  maxArbiter: number;
  fastTemperature: number;
}

export interface ApplyConfig {
  verifyTimeoutMs: number;
  saveQuietMs: number;
  maxActionRetries: number;
  clearExtra: boolean;
}

export interface UiConfig {
  theme: 'auto' | 'light' | 'dark';
  riskDefaultExcluded: boolean;
  autoEnterPreview: boolean;
  showServerKey: boolean;
}

export interface SyncConfig {
  apiBase: string;
  code: string;
}

export interface AppConfig {
  version: number;
  providers: ProviderConfig[];
  engine: EngineConfig;
  apply: ApplyConfig;
  ui: UiConfig;
  sync: SyncConfig;
}

export interface TimerInfo {
  text: string;
  remainingSec?: number;
}
