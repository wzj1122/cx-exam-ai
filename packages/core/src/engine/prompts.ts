import type { QuestionSnapshot } from '../types';
import { truncate } from '../utils/text';

export const PROMPT_VERSION = 'v2.0-2026-11-24';

export function questionForPrompt(q: QuestionSnapshot) {
  return {
    id: q.id,
    type: q.typeLabel || q.type,
    stem: truncate(q.stem, 4000),
    options: q.options.map((o) => ({
      id: o.id,
      text: truncate(o.text, 800),
    })),
  };
}

export function batchSolveSystem(): string {
  return [
    '你是超星学习通考试答题器。',
    '你只会看到题干和选项，必须独立作答。',
    '选项使用内部 ID（O1、O2…），不要回答 A/B/C。',
    '只输出 JSON，不要 Markdown，不要解释。',
    '输出格式：{"answers":[{"id":"题目id","optionIds":["O2"],"confidence":0.82,"reason":"不超过40字"}]}',
    '单选题/判断题只给一个 optionId；多选题给多个；没有选项的题给 "text" 字段。',
    '不确定时降低 confidence，但不要编造选项 ID。',
  ].join('\n');
}

export function batchSolveUser(questions: QuestionSnapshot[]): string {
  return [
    '请回答下列题目，严格返回 JSON：',
    JSON.stringify({ questions: questions.map(questionForPrompt) }),
  ].join('\n\n');
}

export function singleSolveSystem(): string {
  return [
    '你是超星学习通考试答题器。',
    '选项使用内部 ID（O1、O2…），不要回答 A/B/C。',
    '只输出 JSON：{"optionIds":["O2"],"text":"","confidence":0.8,"reason":"不超过60字"}。',
    '选择题只填 optionIds；没有选项的题只填 text。',
  ].join('\n');
}

export function singleSolveUser(q: QuestionSnapshot): string {
  return `请回答这道题：\n${JSON.stringify(questionForPrompt(q))}`;
}

export function verifySystem(): string {
  return [
    '你是考试答案复核员。',
    '你会看到题目、选项和候选答案。请独立判断候选答案是否正确。',
    '只输出 JSON：{"agree":true,"optionIds":["O2"],"confidence":0.8,"reason":"不超过60字"}。',
    '如果候选答案错误，agree=false，并在 optionIds 给出你认为正确的内部 ID。',
    '不要回答 A/B/C，只使用 O1、O2 这样的内部 ID。',
  ].join('\n');
}

export function verifyUser(q: QuestionSnapshot, candidateIds: string[], candidateText: string): string {
  return [
    '请复核这道题：',
    JSON.stringify({
      question: questionForPrompt(q),
      candidate: {
        optionIds: candidateIds,
        text: truncate(candidateText, 1000),
      },
    }),
  ].join('\n');
}

export function arbiterSystem(): string {
  return [
    '你是考试答案仲裁员。',
    '你会看到题目、初答和复核意见。请给出最终答案。',
    '只输出 JSON：{"optionIds":["O2"],"text":"","confidence":0.8,"reason":"不超过60字"}。',
    '只使用 O1、O2 内部 ID。',
  ].join('\n');
}

export function arbiterUser(
  q: QuestionSnapshot,
  firstIds: string[],
  verifyIds: string[],
  verifyAgree: boolean | null,
): string {
  return [
    '请仲裁：',
    JSON.stringify({
      question: questionForPrompt(q),
      firstAnswer: firstIds,
      verifyAnswer: verifyIds,
      verifyAgree,
    }),
  ].join('\n');
}
