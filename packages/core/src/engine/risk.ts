import type { QuestionAnswer, QuestionSnapshot } from '../types';

export function assessRisk(
  question: QuestionSnapshot,
  answer: Omit<QuestionAnswer, 'risk' | 'riskReasons'>,
  threshold: number,
): { risk: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (answer.confidence < threshold) reasons.push(`置信度 ${Math.round(answer.confidence * 100)}% 低于 ${Math.round(threshold * 100)}%`);
  if (question.options.length && answer.optionIds.length === 0 && !answer.serverKeys.length) reasons.push('未映射到选项');
  if (!question.options.length && !String(answer.answerText || '').trim()) reasons.push('文本答案为空');
  if (question.type === 'multiple' && answer.optionIds.length === 0) reasons.push('多选题没有选项');
  const chosen = question.options.filter((o) => answer.optionIds.includes(o.id));
  if (chosen.some((o) => o.keyConfidence === 'low')) reasons.push('选项键只能按位置推断');
  if (answer.stage === 'verify' || answer.stage === 'arbiter') {
    // verifier/arbiter already improved confidence; no extra reason
  }
  return { risk: reasons.length > 0, reasons };
}
