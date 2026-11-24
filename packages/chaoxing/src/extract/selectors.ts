export const QUESTION_ROOT_SELECTOR = '.questionLi';

export const OPTION_ROW_SELECTORS = [
  '.stem_answer .answerBg',
  '.stem_answer .hoverDiv',
  '.stem_answer .Cy_ulTop li',
  '.Cy_ulTop li',
  'li[onclick*="addChoice"]',
  'li[onclick*="addMultipleChoice"]',
  '.B-answerCon span[choice_name]',
].join(',');

export const ADD_CHOICE_FALLBACK_SELECTOR = '.addChoice[qid]';

export const TYPE_LABELS: Record<string, string> = {
  single: '单选题',
  multiple: '多选题',
  judgement: '判断题',
  completion: '填空/简答',
  unknown: '未知题型',
};

export const TYPE_CODE_MAP: Record<string, string> = {
  '0': 'single',
  '1': 'multiple',
  '2': 'completion',
  '3': 'judgement',
  '4': 'completion',
  '5': 'completion',
  '6': 'completion',
  '7': 'completion',
  '8': 'completion',
  '9': 'completion',
  '10': 'completion',
  '11': 'completion',
  '12': 'completion',
  '13': 'completion',
  '14': 'completion',
  '15': 'completion',
  '16': 'completion',
  '17': 'completion',
};
