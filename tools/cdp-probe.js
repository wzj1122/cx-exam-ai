#!/usr/bin/env node
/**
 * 现场取证：把当前考试/作业页里"点击到底怎么了"所需的全部事实一次性 dump 出来。
 *
 *   node tools/cdp-probe.js            # 当前页面
 *   node tools/cdp-probe.js --match exam
 *
 * 关注点（都是真的踩过的坑）：
 *   1) 选项元素到底挂在哪个节点上（.answer_p / a.answerBg / li）
 *   2) 选中态用什么表达（类名？input.checked？aria-checked？）
 *   3) 行内 onclick 指向什么函数，该函数在页面里存不存在
 *   4) 点一次之后 DOM 有没有变、有没有发请求（配合 tools/cdp-net.js）
 */
const HTTP = process.env.CDP_HTTP || 'http://127.0.0.1:9222';

function arg(name, def) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 ? process.argv[i + 1] : def;
}

const PROBE = `(() => {
  const brief = (el) => {
    if (!el) return null;
    const path = [];
    let cur = el, n = 0;
    while (cur && cur.nodeType === 1 && n++ < 6) {
      path.push(cur.tagName.toLowerCase() + (cur.id ? '#' + cur.id : '') + (cur.className && typeof cur.className === 'string' ? '.' + cur.className.trim().split(/\\s+/).join('.') : ''));
      cur = cur.parentElement;
    }
    return path.join(' < ');
  };
  const fnNames = new Set();
  document.querySelectorAll('[onclick]').forEach((el) => {
    const v = el.getAttribute('onclick') || '';
    const m = v.match(/([A-Za-z_$][\\w$]*)\\s*\\(/);
    if (m) fnNames.add(m[1]);
  });
  const fnExist = {};
  fnNames.forEach((n) => { try { fnExist[n] = typeof window[n]; } catch (e) { fnExist[n] = 'err'; } });

  const qs = Array.from(document.querySelectorAll('.questionLi, .TiMu')).slice(0, 2).map((q) => {
    const typeInp = q.querySelector('input[name^="type"], input[id^="answertype"]');
    const stemEl = q.querySelector('.mark_name, :scope > h3, .splitS-left .mark_name, h3');
    const opts = Array.from(q.querySelectorAll('.answerBg .answer_p, .textDIV, .eidtDiv'));
    const uniq = opts.filter((el) => !opts.some((o) => o !== el && o.contains(el)));
    return {
      type: typeInp ? typeInp.value : null,
      stem: stemEl ? stemEl.textContent.trim().slice(0, 40) : null,
      optionCount: uniq.length,
      options: uniq.slice(0, 4).map((el) => {
        const host = el.parentElement || el;
        const inp = host.querySelector('input[type=radio],input[type=checkbox]') || el.querySelector('input');
        return {
          text: (el.textContent || '').trim().slice(0, 26),
          path: brief(el),
          hostCls: host.className || '',
          selfCls: el.className || '',
          hasCheck: !!host.querySelector('[class*="check_answer"],[class*="checkAnswer"]'),
          aria: host.getAttribute && host.getAttribute('aria-checked'),
          input: inp ? { type: inp.type, checked: !!inp.checked, attr: inp.getAttribute && inp.getAttribute('checked') } : null,
          inlineOnclick: (() => { let c = el, i = 0; while (c && i++ < 5) { const v = c.getAttribute && c.getAttribute('onclick'); if (v) return v.slice(0, 60); c = c.parentElement; } return null; })()
        };
      })
    };
  });

  return {
    url: location.href,
    title: document.title,
    questionLi: document.querySelectorAll('.questionLi').length,
    tiMu: document.querySelectorAll('.TiMu').length,
    nextBtn: !!document.querySelector('[onclick*="getTheNextQuestion"]'),
    saveBtn: !!document.querySelector('[onclick*="saveQuestion"], .saveQuestion, [class*="save_btn"]'),
    iframes: Array.from(document.querySelectorAll('iframe')).map((f) => (f.src || '').slice(0, 80)),
    pageFns: fnExist,
    globals: {
      chooseAnswer: typeof window.chooseAnswer,
      saveQuestion: typeof window.saveQuestion,
      getTheNextQuestion: typeof window.getTheNextQuestion,
      jQuery: window.jQuery ? window.jQuery.fn.jquery : null,
      cxScriptLoaded: !!document.querySelector('[class*="cxai"], #cxai-root, .cx-ai-root')
    },
    questions: qs
  };
})()`;

(async () => {
  const list = await (await fetch(HTTP + '/json/list')).json();
  const pages = list.filter((t) => t.type === 'page');
  const match = arg('match', '');
  const t =
    (match && pages.find((p) => (p.url || '').indexOf(match) >= 0)) ||
    pages.find((p) => /^https?:/.test(p.url || '')) ||
    pages[0];
  if (!t) throw new Error('没有可调试页面');
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = () => rej(new Error('WS 连接失败'));
  });
  const out = await new Promise((res, rej) => {
    const id = 1;
    const timer = setTimeout(() => rej(new Error('超时')), 15000);
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id !== id) return;
      clearTimeout(timer);
      if (m.error) return rej(new Error(JSON.stringify(m.error)));
      res(m.result && m.result.result && m.result.result.value);
    };
    ws.send(
      JSON.stringify({
        id,
        method: 'Runtime.evaluate',
        params: { expression: PROBE, returnByValue: true, awaitPromise: true }
      })
    );
  });
  console.log(JSON.stringify(out, null, 2));
  ws.close();
})().catch((e) => {
  console.error('probe 失败：', e.message);
  process.exit(1);
});
