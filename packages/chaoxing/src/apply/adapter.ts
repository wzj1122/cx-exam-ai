import {
  normText,
  parseJsonLoose,
  sleep,
  unique,
} from '@cx/core';
import type {
  ApplyPlan,
  ApplyResult,
  ExamPageInfo,
  ExamPaper,
  ExamTimer,
  NextQuestionResult,
  OptionSnapshot,
  PageAdapter,
  QuestionSnapshot,
  QuestionState,
} from '@cx/core';
import {
  parseServerKeys,
  readServerValue,
  snapshotQuestion,
} from '../extract/dom';
import {
  detectPage,
  nextButton,
  previewEntry,
  readTimer,
  snapshotPaper,
} from '../extract/paper';
import { humanClick, waitFor } from './click';

export interface ChaoxingAdapterOptions {
  doc?: Document;
  url?: string;
  verifyTimeoutMs?: number;
  saveQuietMs?: number;
  maxActionRetries?: number;
  pageWindow?: Window;
}

export class ChaoxingAdapter implements PageAdapter {
  private readonly doc: Document;
  private readonly url: string;
  private readonly verifyTimeoutMs: number;
  private readonly saveQuietMs: number;
  private readonly maxActionRetries: number;
  private readonly pageWindow?: Window;
  private lastQuestionHtml = '';

  constructor(options: ChaoxingAdapterOptions = {}) {
    this.doc = options.doc || document;
    this.url = options.url || location.href;
    this.verifyTimeoutMs = options.verifyTimeoutMs ?? 1600;
    this.saveQuietMs = options.saveQuietMs ?? 450;
    this.maxActionRetries = options.maxActionRetries ?? 1;
    this.pageWindow = options.pageWindow;
  }

  detect(): ExamPageInfo | null {
    return detectPage(this.doc, this.url);
  }

  snapshotPaper(): ExamPaper {
    return snapshotPaper(this.doc, this.url);
  }

  snapshotQuestion(questionId: string): QuestionSnapshot | null {
    return this.snapshotPaper().questions.find((q) => q.id === questionId) || null;
  }

  readState(questionId: string): QuestionState | null {
    const paper = this.snapshotPaper();
    const q = paper.questions.find((item) => item.id === questionId);
    if (!q) return null;
    const parsed = parseServerKeys(q.serverValue, q.options);
    const domOptionIds = q.options.filter((o) => o.selectedDom).map((o) => o.id);
    return {
      questionId: q.id,
      serverKeys: parsed.ids.map((id) => q.options.find((o) => o.id === id)?.serverKey || '').filter(Boolean),
      serverValue: q.serverValue,
      domOptionIds,
      answered: q.answered,
    };
  }

  /**
   * Read-only apply rehearsal. Used for real exam dry-runs; never clicks.
   */
  dryRun(plan: ApplyPlan): {
    ok: boolean;
    reason?: string;
    targetServerKeys: string[];
    currentServerKeys: string[];
    addOptionIds: string[];
    removeOptionIds: string[];
  } {
    const q = this.snapshotQuestion(plan.questionId);
    if (!q) {
      return { ok: false, reason: 'QUESTION_GONE', targetServerKeys: [], currentServerKeys: [], addOptionIds: [], removeOptionIds: [] };
    }
    if (q.fingerprint !== plan.fingerprint) {
      return { ok: false, reason: 'QUESTION_CHANGED', targetServerKeys: [], currentServerKeys: [], addOptionIds: [], removeOptionIds: [] };
    }
    const targets = plan.targetOptionIds
      .map((id) => q.options.find((o) => o.id === id))
      .filter((o): o is OptionSnapshot => !!o);
    if (targets.length !== plan.targetOptionIds.length) {
      return { ok: false, reason: 'OPTION_MISSING', targetServerKeys: [], currentServerKeys: [], addOptionIds: [], removeOptionIds: [] };
    }
    const current = parseServerKeys(q.serverValue, q.options).ids;
    const addOptionIds = plan.targetOptionIds.filter((id) => !current.includes(id));
    const removeOptionIds = plan.clearExtra ? current.filter((id) => !plan.targetOptionIds.includes(id)) : [];
    return {
      ok: true,
      targetServerKeys: targets.map((o) => o.serverKey).filter(Boolean),
      currentServerKeys: current
        .map((id) => q.options.find((o) => o.id === id)?.serverKey || '')
        .filter(Boolean),
      addOptionIds,
      removeOptionIds,
    };
  }

  async apply(plan: ApplyPlan): Promise<ApplyResult> {
    const before = this.snapshotPaper().questions.find((q) => q.id === plan.questionId);
    if (!before) {
      return this.failure(plan, 'QUESTION_GONE', '题目已不在页面上');
    }
    if (before.fingerprint !== plan.fingerprint) {
      return this.failure(plan, 'QUESTION_CHANGED', '题目内容或选项已变化，已中止');
    }
    if (!before.options.length && plan.textAnswer != null) {
      return this.applyText(before, plan.textAnswer);
    }
    const targetIds = unique(plan.targetOptionIds);
    if (!targetIds.length && !String(plan.textAnswer || '').trim()) {
      return this.failure(plan, 'MANUAL_REQUIRED', '答案为空，拒绝清空页面选项');
    }
    const targets = targetIds
      .map((id) => before.options.find((o) => o.id === id))
      .filter((o): o is OptionSnapshot => !!o);
    if (targets.length !== targetIds.length) {
      return this.failure(plan, 'OPTION_MISSING', '目标选项在当前页面找不到，已中止');
    }
    const currentParsed = parseServerKeys(before.serverValue, before.options);
    const currentIds = currentParsed.ids;
    const adds = targetIds.filter((id) => !currentIds.includes(id));
    const removes = plan.clearExtra ? currentIds.filter((id) => !targetIds.includes(id)) : [];
    const clicks: string[] = [];
    for (const id of removes) {
      const result = await this.clickOption(plan.questionId, id, false, plan.fingerprint);
      clicks.push(`-${id}`);
      if (!result.ok) return result;
    }
    for (const id of adds) {
      const result = await this.clickOption(plan.questionId, id, true, plan.fingerprint);
      clicks.push(`+${id}`);
      if (!result.ok) return result;
    }
    const after = this.snapshotQuestion(plan.questionId);
    if (!after) return this.failure(plan, 'QUESTION_GONE', '填写后题目消失');
    const finalParsed = parseServerKeys(after.serverValue, after.options);
    const hasServerValue = !!(before.serverValue || after.serverValue);
    const expectedKeys = targetIds
      .map((id) => before.options.find((o) => o.id === id)?.serverKey || '')
      .filter(Boolean)
      .sort();
    const actualIds = hasServerValue
      ? finalParsed.ids
      : after.options.filter((o) => o.selectedDom).map((o) => o.id);
    const actualKeys = actualIds
      .map((id) => after.options.find((o) => o.id === id)?.serverKey || '')
      .filter(Boolean)
      .sort();
    const ok = hasServerValue
      ? expectedKeys.length === actualKeys.length &&
        expectedKeys.every((key, index) => key === actualKeys[index])
      : targetIds.length === actualIds.length && targetIds.every((id) => actualIds.includes(id));
    return {
      ok,
      questionId: plan.questionId,
      actualServerKeys: actualKeys,
      actualOptionIds: actualIds,
      clicks,
      failureCode: ok ? undefined : 'SERVER_MISMATCH',
      message: ok ? undefined : `页面答案 ${actualKeys.join('') || '空'} != 目标 ${expectedKeys.join('')}`,
      domSignature: this.domSignature(after),
    };
  }

  private async clickOption(
    questionId: string,
    optionId: string,
    wantSelected: boolean,
    fingerprint: string,
  ) {
    let lastResult: ApplyResult | null = null;
    for (let attempt = 0; attempt <= this.maxActionRetries; attempt++) {
      const q = this.snapshotQuestion(questionId);
      if (!q) return this.failure({ questionId, fingerprint: '', targetOptionIds: [], clearExtra: true }, 'QUESTION_GONE', '题目消失');
      if (q.fingerprint !== fingerprint) {
        return this.failure(
          { questionId, fingerprint, targetOptionIds: [], clearExtra: true },
          'QUESTION_CHANGED',
          '填写过程中题目被页面替换，已中止',
        );
      }
      const option = q.options.find((o) => o.id === optionId);
      if (!option) {
        return this.failure({ questionId, fingerprint: q.fingerprint, targetOptionIds: [], clearExtra: true }, 'OPTION_MISSING', `选项 ${optionId} 不存在`);
      }
      const before = parseServerKeys(q.serverValue, q.options).ids;
      const hasServerValue = !!q.serverValue;
      const isSelected = hasServerValue ? before.includes(optionId) : option.selectedDom;
      if (wantSelected === isSelected) return { ok: true, questionId, actualServerKeys: [], actualOptionIds: [], clicks: [] };
      const clickTarget = attempt === 0 ? option.clickElement || option.element : option.element || option.clickElement;
      await humanClick(clickTarget || null);
      const changed = await waitFor(() => {
        const fresh = this.snapshotQuestion(questionId);
        if (!fresh) return false;
        const ids = parseServerKeys(fresh.serverValue, fresh.options).ids;
        const selected = fresh.serverValue
          ? ids.includes(optionId)
          : !!fresh.options.find((o) => o.id === optionId)?.selectedDom;
        return wantSelected ? selected : !selected;
      }, this.verifyTimeoutMs);
      if (changed) {
        await sleep(this.saveQuietMs);
        return { ok: true, questionId, actualServerKeys: [], actualOptionIds: [], clicks: [optionId] };
      }
      lastResult = {
        ok: false,
        questionId,
        actualServerKeys: [],
        actualOptionIds: before,
        clicks: [optionId],
        failureCode: 'NO_STATE_CHANGE',
        message: `点击选项 ${option.displayLabel} 后页面状态没有变化`,
        domSignature: this.domSignature(q),
      };
    }
    return lastResult || {
      ok: false,
      questionId,
      actualServerKeys: [],
      actualOptionIds: [],
      clicks: [],
      failureCode: 'NO_STATE_CHANGE',
      message: '点击后页面状态没有变化',
    };
  }

  private async applyText(q: QuestionSnapshot, text: string): Promise<ApplyResult> {
    const target = q.inputs.find((input) => input.element)?.element as
      | HTMLInputElement
      | HTMLTextAreaElement
      | HTMLIFrameElement
      | undefined;
    if (!target) {
      return {
        ok: false,
        questionId: q.id,
        actualServerKeys: [],
        actualOptionIds: [],
        clicks: [],
        failureCode: 'MANUAL_REQUIRED',
        message: '没有找到可写入的答题框',
      };
    }
    try {
      if (target.tagName === 'IFRAME') {
        const editor = this.editorForQuestion(q);
        if (editor) this.setEditorText(editor, text);
        else {
          const body = (target as HTMLIFrameElement).contentDocument?.body;
          if (!body) throw new Error('iframe 未就绪');
          body.innerHTML = String(text)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/\n/g, '<br>');
          body.dispatchEvent(new Event('input', { bubbles: true }));
        }
      } else {
        const input = target as HTMLInputElement | HTMLTextAreaElement;
        const proto = input.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
        if (setter) setter.call(input, text);
        else input.value = text;
        const editor = this.editorForQuestion(q);
        if (editor) this.setEditorText(editor, text);
        for (const type of ['input', 'change', 'blur']) {
          input.dispatchEvent(new Event(type, { bubbles: true }));
        }
      }
      const saveButton = q.root?.querySelector(
        '[onclick*="saveQuestion"], .saveQuestion, [class*="save_btn"], .savebtndiv, [class*="savebtn"]',
      ) as HTMLElement | null;
      if (saveButton) {
        await humanClick(saveButton);
      }
      await sleep(this.saveQuietMs);
      const fresh = this.snapshotQuestion(q.id);
      const rawHidden = fresh?.root ? readServerValue(fresh.root, fresh.qid).value : '';
      const hidden = /^(0|false|null)$/i.test(rawHidden.trim()) ? '' : rawHidden;
      const value =
        [fresh?.inputs.map((i) => i.value).filter(Boolean).join(' '), hidden].filter(Boolean).join(' ') || '';
      return {
        ok: !!value,
        questionId: q.id,
        actualServerKeys: [],
        actualOptionIds: [],
        clicks: [],
        failureCode: value ? undefined : 'SERVER_MISMATCH',
        message: value ? undefined : '写入后没有读到文本',
      };
    } catch (error) {
      return {
        ok: false,
        questionId: q.id,
        actualServerKeys: [],
        actualOptionIds: [],
        clicks: [],
        failureCode: 'PAGE_ERROR',
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private editorForQuestion(q: QuestionSnapshot): any | null {
    const api = (window as any).UE || (window as any).ue;
    if (!api) return null;
    const pools = [api.instances, api.instants].filter((pool) => pool && typeof pool === 'object');
    const qid = q.qid || '';
    for (const pool of pools) {
      for (const key of Object.keys(pool)) {
        const editor = (pool as any)[key];
        if (!editor) continue;
        const editorId = String(editor.id || editor.key || key || '');
        const container = editor.container as Element | undefined;
        if ((qid && editorId.includes(qid)) || (q.root && container && q.root.contains(container))) {
          return editor;
        }
      }
    }
    if (qid && typeof api.getEditor === 'function') {
      for (const id of [`answer${qid}`, `answerEditor${qid}1`, `answerEditor${qid}`]) {
        try {
          const editor = api.getEditor(id);
          if (editor && editor.body) return editor;
        } catch {
          // try next id
        }
      }
    }
    return null;
  }

  private setEditorText(editor: any, text: string): void {
    if (!editor || typeof editor.setContent !== 'function') return;
    const html = String(text)
      .split(/\r?\n/)
      .map((line) => `<p>${line.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>`)
      .join('');
    try {
      editor.setContent(html, false);
    } catch {
      editor.setContent(html);
    }
    if (typeof editor.sync === 'function') editor.sync();
  }

  async nextQuestion(): Promise<NextQuestionResult> {
    const before = this.doc.querySelector('.questionLi')?.outerHTML || '';
    const button = nextButton(this.doc);
    if (!button) return { ok: false, end: true, message: '没有下一题按钮' };
    await humanClick(button);
    const changed = await waitFor(() => {
      const now = this.doc.querySelector('.questionLi')?.outerHTML || '';
      return !!now && now !== before;
    }, Math.max(this.verifyTimeoutMs, 3000), 120);
    return {
      ok: changed,
      end: false,
      message: changed ? undefined : '翻页后没有检测到新题',
      url: changed ? this.doc.location?.href : undefined,
    };
  }

  async enterPreview(): Promise<boolean> {
    const entry = previewEntry(this.doc);
    if (!entry) return false;
    await humanClick(entry);
    return waitFor(() => this.doc.querySelectorAll('.questionLi').length > 1, 5000, 150);
  }

  async jumpToQuestion(number: number, qid?: string): Promise<NextQuestionResult> {
    const current = this.snapshotPaper().questions[0];
    if ((qid && current?.qid === qid) || (!qid && current?.number === number)) {
      return { ok: true, end: false };
    }
    const before = current?.qid || '';
    let item: HTMLElement | null = null;
    if (qid) item = this.doc.querySelector(`#topicNumberScroll li[data-asq="${qid}"]`) as HTMLElement | null;
    if (!item) {
      item =
        (Array.from(this.doc.querySelectorAll('#topicNumberScroll li')).find(
          (el) => Number((el.textContent || '').trim()) === number,
        ) as HTMLElement | undefined) || null;
    }
    if (!item) return { ok: false, end: false, message: '答案卡里找不到这道题' };
    await humanClick(item);
    const changed = await waitFor(() => {
      const now = this.doc.querySelector('.questionLi')?.getAttribute('data') || '';
      return !!now && now !== before;
    }, Math.max(this.verifyTimeoutMs, 5000), 120);
    return {
      ok: changed,
      end: false,
      message: changed ? undefined : '跳题后没有检测到新题（页面可能在等待确认）',
      url: this.doc.location?.href,
    };
  }

  getTimer(): ExamTimer | null {
    return readTimer(this.doc);
  }

  highlightQuestion(questionId: string): void {
    const q = this.snapshotQuestion(questionId);
    if (!q?.root) return;
    try {
      q.root.scrollIntoView({ block: 'center', behavior: 'smooth' });
      (q.root as HTMLElement).style.outline = '2px solid #4f8cff';
      setTimeout(() => {
        if (q.root) (q.root as HTMLElement).style.outline = '';
      }, 1800);
    } catch {
      // ignore
    }
  }

  private domSignature(q: QuestionSnapshot | null): string {
    if (!q?.root) return '';
    const parts: string[] = [];
    let node: Element | null = q.root;
    for (let i = 0; i < 5 && node; i++) {
      parts.push(`${node.tagName.toLowerCase()}.${(node.getAttribute('class') || '').split(/\s+/).slice(0, 2).join('.')}`);
      node = node.parentElement;
    }
    return parts.join(' < ');
  }

  private failure(plan: ApplyPlan, code: ApplyResult['failureCode'], message: string): ApplyResult {
    return {
      ok: false,
      questionId: plan.questionId,
      actualServerKeys: [],
      actualOptionIds: [],
      clicks: [],
      failureCode: code,
      message,
    };
  }
}
