import * as Dialog from '@radix-ui/react-dialog';
import { useContext, useMemo, useState } from 'react';
import type { OptionSnapshot, QuestionAnswer, QuestionSnapshot } from '@cx/core';
import type { QuestionStatus, WorkbenchController } from '../state/workbench-controller';
import { PortalContainerContext } from '../state/portal';
import { useWorkbenchState } from './use-workbench';

export interface WorkbenchProps {
  controller: WorkbenchController;
  onOpenSettings?: () => void;
  onClose?: () => void;
}

const STATUS_LABEL: Record<QuestionStatus, string> = {
  idle: '待答',
  solving: '判定中',
  ready: '待复核',
  filling: '填写中',
  filled: '已校验',
  manual: '需人工',
  failed: '失败',
};

function statusClass(status: QuestionStatus, risk: boolean): string {
  if (status === 'filled') return 'ok';
  if (status === 'manual' || status === 'failed') return 'err';
  if (status === 'solving' || status === 'filling') return 'wait';
  if (risk) return 'no';
  return '';
}

function shortAnswer(answer: QuestionAnswer | undefined, q: QuestionSnapshot): string {
  if (!answer) return '';
  if (answer.answerText) return answer.answerText.replace(/\s+/g, '').slice(0, 4);
  return answer.optionIds
    .map((id) => q.options.find((o) => o.id === id)?.displayLabel || '')
    .join('')
    .slice(0, 4);
}

function answerSummary(answer: QuestionAnswer | undefined, q: QuestionSnapshot): string {
  if (!answer) return '暂无答案';
  if (answer.answerText) return answer.answerText.slice(0, 64);
  return (
    answer.optionIds
      .map((id) => q.options.find((o) => o.id === id)?.displayLabel || id)
      .join(' ') || '暂无答案'
  );
}

function downloadJson(name: string, text: string) {
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function Workbench({ controller, onOpenSettings, onClose }: WorkbenchProps) {
  const state = useWorkbenchState(controller);
  const portalContainer = useContext(PortalContainerContext);
  const [fillOpen, setFillOpen] = useState(false);
  const paper = state.paper;
  const selected = paper?.questions.find((q) => q.id === state.selectedId) || paper?.questions[0];
  const answer = selected ? state.answers[selected.id] : undefined;
  const fillQuestions = useMemo(
    () => (paper?.questions || []).filter((q) => state.answers[q.id]),
    [paper, state.answers],
  );
  const checked = fillQuestions.filter((q) => state.fillIds.includes(q.id));
  const risky = fillQuestions.filter((q) => state.answers[q.id]?.risk);
  const filledCount = Object.values(state.status).filter((status) => status === 'filled').length;
  const indexItems = paper?.questionIndex?.length
    ? paper.questionIndex
    : (paper?.questions || []).map((q) => ({
        number: q.number,
        qid: q.qid,
        answered: !!state.answers[q.id],
        current: q.id === selected?.id,
      }));

  const setOption = (option: OptionSnapshot) => {
    if (!selected) return;
    const current = state.answers[selected.id]?.optionIds || [];
    if (selected.type === 'multiple') {
      const next = current.includes(option.id)
        ? current.filter((id) => id !== option.id)
        : [...current, option.id];
      controller.setAnswerOption(selected.id, next);
    } else {
      controller.setAnswerOption(selected.id, [option.id]);
    }
  };

  return (
    <div className="cxai-workbench">
      <header className="cxai-hd">
        <div className="cxai-hd-main">
          <strong className="cxai-title">{paper?.title || 'CX 考试 AI'}</strong>
          <div className="cxai-sub">
            <span className="cxai-badge">{paper?.mode === 'preview' ? '整卷' : '单题'}</span>
            {paper?.timer?.text ? <span className="cxai-badge warn">剩 {paper.timer.text}</span> : null}
            {state.running ? <span className="cxai-badge wait">判定中</span> : null}
          </div>
        </div>
        <div className="cxai-hd-actions">
          {paper?.canPreview && paper.mode === 'single' ? (
            <button className="cxai-x" title="进入整卷预览" onClick={() => void controller.enterPreview()}>
              预览
            </button>
          ) : null}
          {onOpenSettings ? (
            <button className="cxai-x" title="设置" onClick={onOpenSettings}>
              ⚙
            </button>
          ) : null}
          {onClose ? (
            <button className="cxai-x close" title="收起" onClick={onClose}>
              ×
            </button>
          ) : null}
        </div>
      </header>

      {state.previewCountdown != null ? (
        <div className="cxai-banner">
          <span>{state.previewCountdown} 秒后进入整卷预览</span>
          <button className="cxai-mini" onClick={() => controller.cancelPreview?.()}>
            留在单题
          </button>
        </div>
      ) : null}
      {state.lastError ? <div className="cxai-alert">{state.lastError}</div> : null}

      <div className="cxai-stat">
        <div>
          <b>{paper?.totalCount || paper?.questions.length || 0}</b>
          <span>题量</span>
        </div>
        <div>
          <b>{fillQuestions.length}</b>
          <span>已判</span>
        </div>
        <div>
          <b className="warn">{risky.length}</b>
          <span>风险</span>
        </div>
        <div>
          <b className="ok">{Math.max(paper?.answeredCount || 0, filledCount)}</b>
          <span>已答</span>
        </div>
        <div>
          <b>{selected?.number || '-'}</b>
          <span>当前</span>
        </div>
      </div>

      <div className="cxai-qgrid">
        {indexItems.length ? (
          indexItems.map((item) => {
            const q = paper?.questions.find((candidate) => candidate.qid === item.qid || candidate.id === item.qid);
            const status = q ? state.status[q.id] || 'idle' : item.answered ? 'filled' : 'idle';
            const a = q ? state.answers[q.id] : undefined;
            const isCurrent = item.current || (!!q && q.id === selected?.id);
            return (
              <button
                key={`${item.number}-${item.qid}`}
                className={`cxai-qcard ${statusClass(status, !!a?.risk)} ${isCurrent ? 'cur' : ''}`}
                title={q ? `${q.typeLabel} · ${answerSummary(a, q)}` : `第 ${item.number} 题${item.answered ? ' · 已答' : ''}`}
                onClick={() => {
                  if (q) controller.setSelected(q.id);
                  else controller.jumpToQuestion?.(item.number, item.qid);
                }}
              >
                <b>{item.number}</b>
                <i>{q ? shortAnswer(a, q) || (item.answered ? '✓' : '·') : item.answered ? '✓' : '·'}</i>
              </button>
            );
          })
        ) : (
          <div className="cxai-empty">还没有题目</div>
        )}
      </div>

      <div className="cxai-detail">
        {selected ? (
          <>
            <div className="cxai-qd-hd">
              <span className="cxai-tag">{selected.typeLabel}</span>
              <span>第 {selected.number} 题</span>
              {selected.qid ? <span className="cxai-dim">qid {selected.qid}</span> : null}
              {answer ? (
                <span className={`cxai-st ${answer.risk ? 'no' : 'ok'}`}>
                  {answer.risk ? '风险' : '可填'} · {Math.round(answer.confidence * 100)}%
                </span>
              ) : (
                <span className="cxai-st todo">待判定</span>
              )}
              <button className="cxai-mini" onClick={() => void controller.solveOne(selected.id)}>
                重判
              </button>
            </div>
            <p className="cxai-stem">{selected.stem}</p>
            {selected.options.length ? (
              <div className="cxai-opts">
                {selected.options.map((option) => {
                  const active = !!answer?.optionIds.includes(option.id);
                  return (
                    <button
                      key={option.id}
                      type="button"
                      className={`cxai-opt ${active ? 'on' : ''}`}
                      onClick={() => setOption(option)}
                    >
                      <b>{option.displayLabel}</b>
                      <span>{option.text}</span>
                      {option.serverKey && option.serverKey !== option.displayLabel ? (
                        <em>键 {option.serverKey}</em>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            ) : (
              <textarea
                className="cxai-textarea"
                value={answer?.answerText || ''}
                placeholder="文本题答案会显示在这里，可直接修改"
                onChange={(event) => controller.setAnswerText(selected.id, event.target.value)}
              />
            )}
            {answer?.reason ? <div className="cxai-reason">{answer.reason}</div> : null}
            {answer?.riskReasons.length ? (
              <ul className="cxai-risk">
                {answer.riskReasons.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            ) : null}
            <div className="cxai-qd-actions">
              <button className="cxai-mini" onClick={() => void controller.applyOne(selected.id)}>
                填入本题
              </button>
              {paper?.mode === 'single' && controller.applyAndNext ? (
                <button className="cxai-mini primary" onClick={() => void controller.applyAndNext?.(selected.id)}>
                  填入并下一题
                </button>
              ) : null}
            </div>
          </>
        ) : (
          <div className="cxai-empty">点上面的题号查看题目和答案</div>
        )}

        {state.verifyDiffs.length ? (
          <div className="cxai-alert">
            复核发现 {state.verifyDiffs.length} 道题不一致：
            {state.verifyDiffs.map((diff) => `第 ${diff.number} 题（${diff.expected || '空'}/${diff.actual || '空'}）`).join('；')}
          </div>
        ) : null}
      </div>

      <footer className="cxai-ft">
        <span className="cxai-ft-count">
          勾选 {checked.length}/{fillQuestions.length} · 风险 {risky.length}
        </span>
        <span className="cxai-ft-actions">
          <button className="cxai-btn" onClick={() => void controller.verifyAll()} disabled={!paper}>
            复核
          </button>
          <button
            className="cxai-btn"
            onClick={() => downloadJson(`cx-exam-ai-diag-${Date.now()}.json`, controller.exportDiagnostics())}
          >
            导出
          </button>
          <button
            className="cxai-btn primary"
            disabled={!checked.length || state.running}
            onClick={() => setFillOpen(true)}
          >
            一键填写
          </button>
        </span>
      </footer>

      {state.logs.length ? (
        <details className="cxai-logs">
          <summary>日志 {state.logs.length}</summary>
          {state.logs.slice(-40).join('\n')}
        </details>
      ) : null}

      <Dialog.Root open={fillOpen} onOpenChange={setFillOpen} modal={false}>
        <Dialog.Portal container={portalContainer || undefined}>
          <Dialog.Overlay className="cxai-dialog-overlay" />
          <Dialog.Content className="cxai-dialog">
            <Dialog.Title className="cxai-dialog-title">确认填写</Dialog.Title>
            <p className="cxai-dim">将按题号顺序串行填写 {checked.length} 道题；风险题默认不填。</p>
            <div className="cxai-dialog-list">
              {fillQuestions.map((q) => (
                <label key={q.id} className="cxai-dialog-row">
                  <input
                    type="checkbox"
                    checked={state.fillIds.includes(q.id)}
                    onChange={() => controller.toggleFill(q.id)}
                  />
                  <span>第 {q.number} 题</span>
                  <span className="cxai-dim">{answerSummary(state.answers[q.id], q)}</span>
                  {state.answers[q.id]?.risk ? <span className="cxai-st no">风险</span> : null}
                </label>
              ))}
            </div>
            <div className="cxai-dialog-actions">
              <Dialog.Close asChild>
                <button className="cxai-btn">取消</button>
              </Dialog.Close>
              <button
                className="cxai-btn primary"
                onClick={() => {
                  setFillOpen(false);
                  void controller.applyAll();
                }}
              >
                确认填写
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
