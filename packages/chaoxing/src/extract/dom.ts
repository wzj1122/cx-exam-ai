import { hashString, normText, stripHtml, unique } from '@cx/core';
import type {
  InputSnapshot,
  OptionSnapshot,
  QuestionSnapshot,
  QuestionType,
} from '@cx/core';
import {
  ADD_CHOICE_FALLBACK_SELECTOR,
  OPTION_ROW_SELECTORS,
  TYPE_CODE_MAP,
  TYPE_LABELS,
} from './selectors';

const SELECTED_TOKEN = /^(check_?answer\w*|checked|selected|active|chosed|chosen|curSelected)$/i;

export function textOf(el: Element | null | undefined): string {
  return normText(el?.textContent || '');
}

export function classTokens(el: Element | null | undefined): string[] {
  const raw = el?.getAttribute?.('class') || '';
  return raw.split(/\s+/).filter(Boolean);
}

export function hasSelectedClass(el: Element | null | undefined): boolean {
  if (!el) return false;
  return classTokens(el).some((token) => !/^un/i.test(token) && SELECTED_TOKEN.test(token));
}

export function isVisible(el: Element | null | undefined): boolean {
  if (!el) return false;
  const html = el as HTMLElement;
  if (html.offsetParent === null && html.getClientRects?.().length === 0) return false;
  return true;
}

export function qidOf(root: Element, doc: Document = document): string {
  const box = root.closest('.questionLi') || root;
  const data = box.getAttribute('data') || root.getAttribute('data') || '';
  if (/^\d{4,}$/.test(data.trim())) return data.trim();
  const typeInput = root.querySelector('input[name^="type"], input[id^="answertype"]');
  if (typeInput) {
    const name = typeInput.getAttribute('name') || '';
    const id = typeInput.getAttribute('id') || '';
    const byName = /^type(\d{4,})$/.exec(name);
    const byId = /^answertype(\d{4,})$/.exec(id);
    if (byName) return byName[1];
    if (byId) return byId[1];
  }
  const answerInput = root.querySelector('input[name^="answer"], input[id^="answer"]');
  if (answerInput) {
    const name = answerInput.getAttribute('name') || '';
    const id = answerInput.getAttribute('id') || '';
    const byName = /^(?:answer|answers)(\d{4,})$/.exec(name);
    const byId = /^(?:answer|answers)(\d{4,})$/.exec(id);
    if (byName) return byName[1];
    if (byId) return byId[1];
  }
  const global = doc.querySelector('#questionId, input[name="questionId"]') as HTMLInputElement | null;
  return global?.value ? String(global.value).trim() : '';
}

export function typeOf(root: Element): { type: QuestionType; label: string } {
  const declared = (root.getAttribute('typename') || '').trim();
  if (declared) {
    if (/多选/.test(declared)) return { type: 'multiple', label: declared };
    if (/判断/.test(declared)) return { type: 'judgement', label: declared };
    if (/单选/.test(declared)) return { type: 'single', label: declared };
    if (/填空|简答|论述|名词|计算|阅读|完形/.test(declared)) return { type: 'completion', label: declared };
  }
  const inputs = Array.from(
    root.querySelectorAll('input[name^="type"], input[id^="answertype"]'),
  ) as HTMLInputElement[];
  const input =
    inputs.find((el) => {
      const name = el.getAttribute('name') || '';
      const id = el.getAttribute('id') || '';
      return /^type\d{4,}$/.test(name) || /^answertype\d{4,}$/.test(id);
    }) ||
    inputs.find((el) => {
      const name = el.getAttribute('name') || '';
      return name !== 'type' && name !== '';
    }) ||
    null;
  if (input) {
    const value = String(input.value || '').trim();
    const mapped = TYPE_CODE_MAP[value];
    if (mapped) {
      return { type: mapped as QuestionType, label: TYPE_LABELS[mapped] || mapped };
    }
  }
  const html = root.innerHTML || '';
  if (/addMultipleChoice|clickSaveMultiSelect/.test(html)) return { type: 'multiple', label: TYPE_LABELS.multiple };
  if (/addChoice|saveSingleSelect/.test(html)) return { type: 'single', label: TYPE_LABELS.single };
  if (root.querySelector('.num_option_dx')) return { type: 'multiple', label: TYPE_LABELS.multiple };
  if (root.querySelector('.num_option')) return { type: 'single', label: TYPE_LABELS.single };
  const boolOption = root.querySelector('span[data="true"], span[data="false"], [choice_name="true"], [choice_name="false"]');
  if (boolOption) return { type: 'judgement', label: TYPE_LABELS.judgement };
  const rows = Array.from(root.querySelectorAll('.answerBg, .hoverDiv, .Cy_ulTop li'));
  if (rows.length === 2) {
    const texts = rows.map((row) => textOf(row));
    if (texts.some((text) => /对|正确/.test(text)) && texts.some((text) => /错|错误/.test(text))) {
      return { type: 'judgement', label: TYPE_LABELS.judgement };
    }
  }
  return { type: 'unknown', label: TYPE_LABELS.unknown };
}

export function readStem(root: Element): string {
  const candidates = [
    '.mark_name',
    '.Zy_TItle',
    '.qtContent',
    '.stem',
    'h3',
  ];
  for (const selector of candidates) {
    const el = root.querySelector(selector);
    if (!el) continue;
    const clone = el.cloneNode(true) as Element;
    clone.querySelectorAll('.colorShallow, .stem_answer, .mark_answer, .score, .questionScore').forEach((n) => n.remove());
    const text = stripHtml(clone.innerHTML || clone.textContent || '');
    if (text) return text;
  }
  const clone = root.cloneNode(true) as Element;
  clone.querySelectorAll('.stem_answer, .mark_answer, textarea, input, iframe, .subEditor, .edui-editor').forEach((n) => n.remove());
  return stripHtml(clone.innerHTML || clone.textContent || '');
}

function optionRows(root: Element): Element[] {
  let all = Array.from(root.querySelectorAll(OPTION_ROW_SELECTORS));
  if (!all.length) all = Array.from(root.querySelectorAll(ADD_CHOICE_FALLBACK_SELECTOR));
  const filtered = all.filter((el) => {
    const tag = String(el.tagName || '').toUpperCase();
    if (tag === 'TEXTAREA' || tag === 'INPUT' || tag === 'SELECT') return false;
    if (el.closest('.mark_answer')) return false;
    if (el.closest('.subEditor, .edui-editor, .edui-default')) return false;
    if (el.querySelector('textarea[id], iframe[id^="ueditor"]')) return false;
    return true;
  });
  // Keep the inner-most row: `.answerBg` inside `li` is the element whose handler works.
  return filtered.filter(
    (el) => !filtered.some((other) => other !== el && el.contains(other)),
  );
}

function prefixLabel(text: string): string {
  const match = /^\s*([A-Ha-h]|[对错])\s*[、.．)）:：]/.exec(text || '');
  return match ? match[1] : '';
}

function cleanOptionText(text: string, displayLabel: string): string {
  let value = normText(text);
  if (displayLabel) {
    const escaped = displayLabel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    value = value.replace(new RegExp(`^\\s*${escaped}\\s*[、.．)）:：]?\\s*`), '');
  }
  return value.trim();
}

function labelElement(row: Element): Element | null {
  return (
    row.querySelector('.num_option, .num_option_dx, .option_num, .num, .choice_name') ||
    (row.matches('span[choice_name]') ? row : null)
  );
}

function serverKeyOf(row: Element, labelEl: Element | null): string {
  const candidates = [
    labelEl?.getAttribute('data'),
    labelEl?.getAttribute('choice_name'),
    row.getAttribute('data'),
    row.getAttribute('data-value'),
    row.getAttribute('value'),
  ];
  for (const raw of candidates) {
    const value = String(raw || '').trim();
    if (!value) continue;
    if (/^\d{6,}$/.test(value)) continue; // this is a qid, not an option key
    return value;
  }
  return '';
}

function textOfOption(row: Element, displayLabel: string): string {
  const answer = row.querySelector('.answer_p, .p_wid805, .answerText, .textDIV');
  if (answer) {
    const value = cleanOptionText(textOf(answer), displayLabel);
    if (value) return value;
  }
  return cleanOptionText(textOf(row), displayLabel);
}

function isOptionSelected(row: Element, labelEl: Element | null): boolean {
  const nodes = [row, labelEl, row.parentElement].filter(Boolean) as Element[];
  if (nodes.some(hasSelectedClass)) return true;
  const input = row.querySelector('input[type="radio"], input[type="checkbox"]') as HTMLInputElement | null;
  return !!(input && (input.checked || input.hasAttribute('checked')));
}

export function readOptions(root: Element): OptionSnapshot[] {
  const rows = optionRows(root);
  const options: OptionSnapshot[] = [];
  rows.forEach((row, index) => {
    const holder =
      (row.closest('.answerBg, .hoverDiv, li, .B-answerCon, .addChoice') as Element | null) || row;
    const labelEl = labelElement(holder) || labelElement(row);
    const rawText = textOf(holder);
    const labelText = labelEl
      ? textOf(labelEl).replace(/[^A-Za-z0-9对错]/g, '').slice(0, 4)
      : '';
    const displayLabel =
      labelText ||
      prefixLabel(rawText) ||
      String.fromCharCode(65 + Math.min(index, 25));
    const serverKey = serverKeyOf(holder, labelEl) || serverKeyOf(row, labelEl);
    const text = textOfOption(holder, displayLabel) || cleanOptionText(rawText, displayLabel) || displayLabel;
    const clickElement =
      (labelEl && (labelEl.getAttribute('onclick') || labelEl.matches('span[choice_name]')) ? labelEl : null) ||
      (holder.getAttribute('onclick') ? holder : null) ||
      holder;
    options.push({
      id: `O${index + 1}`,
      displayLabel,
      serverKey,
      text,
      keyConfidence: serverKey ? 'high' : 'low',
      selectedDom: isOptionSelected(holder, labelEl),
      selectedServer: false,
      element: holder as HTMLElement,
      clickElement: clickElement as HTMLElement,
    });
  });
  return options;
}

export function readInputs(root: Element): InputSnapshot[] {
  const out: InputSnapshot[] = [];
  const nodes = Array.from(root.querySelectorAll('textarea, input[type="text"], iframe'));
  nodes.forEach((el, index) => {
    if (el.closest('.mark_answer')) return;
    const editorHost = el.closest('.subEditor, .edui-editor, .edui-default');
    const editorId = String(el.getAttribute('id') || '');
    if (editorHost && !/^(answerEditor|ueditor_)/i.test(editorId)) return;
    if (el.tagName === 'IFRAME') {
      const src = String(el.getAttribute('src') || '');
      if (/ueditorupload|\/read\?objectid|\.(?:mp4|mp3|pdf)(?:[?#]|$)/i.test(src)) return;
      let value = '';
      try {
        value = String((el as HTMLIFrameElement).contentDocument?.body?.innerText || '').trim();
      } catch {
        value = '';
      }
      out.push({ index, kind: 'iframe', value, element: el as HTMLElement });
      return;
    }
    const input = el as HTMLInputElement | HTMLTextAreaElement;
    out.push({
      index,
      kind: el.tagName === 'TEXTAREA' ? 'textarea' : 'input',
      value: String(input.value || '').trim(),
      element: input,
    });
  });
  return out;
}

export function readImages(root: Element): string[] {
  const urls = Array.from(root.querySelectorAll('img'))
    .filter((img) => !/icon|logo|avatar|qr|blank\.gif|loading/i.test(img.getAttribute('src') || ''))
    .map((img) => (img as HTMLImageElement).src)
    .filter(Boolean);
  return unique(urls);
}

function hiddenInputs(root: Element, qid: string): HTMLInputElement[] {
  const doc = root.ownerDocument;
  const list: HTMLInputElement[] = [];
  if (qid) {
    const selectors = [
      `#answer${qid}`,
      `[name="answer${qid}"]`,
      `[name="answers${qid}"]`,
      `[id="answers${qid}"]`,
    ];
    for (const selector of selectors) {
      const el = doc.querySelector(selector) as HTMLInputElement | null;
      if (el) list.push(el);
    }
  }
  if (!list.length) {
    const local = root.querySelector('input[name^="answer"], input[id^="answer"]') as HTMLInputElement | null;
    if (local) list.push(local);
  }
  return list;
}

export function readServerValue(root: Element, qid: string): { value: string; source: string } {
  for (const input of hiddenInputs(root, qid)) {
    const value = String(input.value || '').trim();
    if (value) return { value, source: input.id || input.name || 'hidden' };
  }
  return { value: '', source: '' };
}

function optionLookup(options: OptionSnapshot[], token: string): OptionSnapshot | null {
  const normalized = token.trim().toUpperCase();
  if (!normalized) return null;
  const byServer = options.find((o) => o.serverKey.trim().toUpperCase() === normalized);
  if (byServer) return byServer;
  const byLabel = options.find((o) => o.displayLabel.trim().toUpperCase() === normalized);
  if (byLabel) return byLabel;
  const byText = options.find((o) => normText(o.text).toUpperCase() === normText(token).toUpperCase());
  return byText || null;
}

export function parseServerKeys(value: string, options: OptionSnapshot[]): { ids: string[]; unmapped: string[] } {
  const raw = String(value || '').trim();
  if (!raw) return { ids: [], unmapped: [] };
  const booleanToken = raw.toLowerCase();
  if (/^(true|false|t|f|1|0|对|错|正确|错误|是|否|√|×)$/.test(booleanToken)) {
    const truthy = /^(true|t|1|对|正确|是|√)$/.test(booleanToken);
    const wanted = options.find((o) => {
      const text = o.text.trim();
      const key = o.serverKey.trim().toLowerCase();
      if (truthy) return /^(true|t|1|对|正确|是|√)$/.test(key) || /^(对|正确|是|√|true)$/.test(text);
      return /^(false|f|0|错|错误|否|×)$/.test(key) || /^(错|错误|否|×|false)$/.test(text);
    });
    return wanted ? { ids: [wanted.id], unmapped: [] } : { ids: [], unmapped: [raw] };
  }
  if (/^[\[{]/.test(raw)) {
    try {
      const parsed = JSON.parse(raw);
      const tokens: string[] = [];
      const walk = (node: unknown) => {
        if (Array.isArray(node)) node.forEach(walk);
        else if (node && typeof node === 'object') {
          const answer = (node as any).answer ?? (node as any).value ?? (node as any).content;
          if (answer != null) walk(answer);
        } else if (node != null) {
          const text = String(node).trim();
          if (text) tokens.push(text);
        }
      };
      walk(parsed);
      return mapTokens(tokens, options);
    } catch {
      // fall through
    }
  }
  const tokens = /^[A-Ha-h]{1,8}$/.test(raw)
    ? raw.toUpperCase().split('')
    : raw.split(/[\s,，、;；|/]+/).filter(Boolean);
  return mapTokens(tokens, options);
}

function mapTokens(tokens: string[], options: OptionSnapshot[]): { ids: string[]; unmapped: string[] } {
  const ids: string[] = [];
  const unmapped: string[] = [];
  for (const token of tokens) {
    const hit = optionLookup(options, token);
    if (hit) ids.push(hit.id);
    else if (token) unmapped.push(token);
  }
  return { ids: Array.from(new Set(ids)), unmapped };
}

export function snapshotQuestion(root: Element, index: number, doc: Document = document): QuestionSnapshot {
  const qid = qidOf(root, doc);
  const { type, label } = typeOf(root);
  const stem = readStem(root);
  const options = readOptions(root);
  const server = readServerValue(root, qid);
  const serverValue =
    type === 'completion' &&
    /^(0|false|null)$/i.test(server.value.trim())
      ? ''
      : server.value;
  const parsed = parseServerKeys(serverValue, options);
  options.forEach((option) => {
    option.selectedServer = parsed.ids.includes(option.id);
  });
  const inputs = readInputs(root);
  const images = readImages(root);
  const domIds = options.filter((o) => o.selectedDom).map((o) => o.id);
  const domValue = domIds.map((id) => options.find((o) => o.id === id)?.serverKey || id).join('');
  const inputValue = inputs.map((i) => i.value).filter(Boolean).join(' ||| ');
  const fingerprint = hashString(
    [qid, type, stem, options.map((o) => `${o.id}:${o.serverKey}:${o.text}`).join('|'), images.join(',')].join('::'),
  );
  const id = qid || `q_${fingerprint}`;
  return {
    id,
    qid,
    number: index + 1,
    type,
    typeLabel: label,
    stem,
    options,
    inputs,
    images,
    serverValue,
    domValue,
    answered: !!serverValue || domIds.length > 0 || !!inputValue,
    fingerprint,
    root: root as HTMLElement,
  };
}
