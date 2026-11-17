/* ---------------- 执行层：拟人化点选与作答写入 ----------------
 * 只做三件事：
 *   1) 把答案落到真实 DOM 上（点选项 / 写填空 / 选判断）
 *   2) 每步都复核是否真的选中，失败换策略重试
 *   3) 所有动作带随机延时与真实事件序列，避免"机器点击"特征
 */

CXAI.Apply = (function () {
  const POINTER_SEQ = ['pointerover', 'mouseover', 'pointerenter', 'mouseenter', 'pointermove', 'mousemove'];

  function sleep(...a) {
    return CXAI.U.sleep(...a);
  }

  /* ---------------- 基础：事件派发 ---------------- */

  function fire(el, type, extra) {
    const isPointer = /^pointer/.test(type);
    const isMouse = /^(mouse|click|dblclick|contextmenu)/.test(type);
    let ev;
    if (isPointer && typeof PointerEvent === 'function') {
      ev = new PointerEvent(type, Object.assign({ bubbles: true, cancelable: true, composed: true, pointerId: 1, pointerType: 'mouse' }, extra || {}));
    } else if (isMouse) {
      ev = new MouseEvent(type, Object.assign({ bubbles: true, cancelable: true, composed: true, view: window }, extra || {}));
    } else {
      ev = new Event(type, { bubbles: true, cancelable: true });
    }
    el.dispatchEvent(ev);
  }

  function centerOf(el) {
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    // 随机落点，避开正中心（真实人手不会每次都点正中）
    const px = 0.25 + Math.random() * 0.5;
    const py = 0.3 + Math.random() * 0.4;
    return {
      x: Math.round(r.left + r.width * px),
      y: Math.round(r.top + r.height * py),
      clientX: Math.round(r.left + r.width * px),
      clientY: Math.round(r.top + r.height * py)
    };
  }

  /**
   * 拟人点击：指针预热 + 一次激活行为。
   *
   * 关键（对齐 ocsjs 的 `option.click()`）：
   *   **一次操作 = 一次 click**。
   * 旧实现先 fire('click') 再 el.click()，等于同一选项被 handler 处理两次：
   *   - 多选/复选的 handler 是 toggle 语义 → 点两次 = 选中又取消；
   *   - 单选虽然幂等，但页面会因此发两次保存请求，后端按最后一次落库。
   * 这就是"页面上明明看到点了，超星却记 0 题"的直接来源。
   */
  async function humanClick(el, opts) {
    opts = opts || {};
    if (!el) return false;
    try {
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    } catch (e) {
      try {
        el.scrollIntoView();
      } catch (e2) {}
    }
    await sleep(CXAI.U.randInt(90, 240));

    const pt = centerOf(el) || { clientX: 0, clientY: 0 };
    const base = {
      clientX: pt.clientX,
      clientY: pt.clientY,
      screenX: pt.clientX + (window.screenX || 0),
      screenY: pt.clientY + (window.screenY || 0),
      button: 0,
      buttons: 0
    };

    // 指针预热：只负责 hover/按下/抬起的"手感"，不触发激活行为
    for (const t of POINTER_SEQ) {
      fire(el, t, base);
      await sleep(CXAI.U.randInt(5, 18));
    }
    fire(el, 'focus', base);
    fire(el, 'pointerdown', Object.assign({}, base, { buttons: 1 }));
    fire(el, 'mousedown', Object.assign({}, base, { buttons: 1 }));
    await sleep(CXAI.U.randInt(45, 120));
    fire(el, 'pointerup', base);
    fire(el, 'mouseup', base);
    await sleep(CXAI.U.randInt(10, 35));

    // 唯一的激发点：原生 click（走页面自己的 handler + 浏览器默认行为）
    try {
      el.click();
    } catch (e) {}
    return true;
  }

  /** 一次点击：语义等同 humanClick，留着是为了让调用点读起来明确"只点一次" */
  function clickOnce(el) {
    return humanClick(el, {});
  }

  /* ---------------- 状态探测 ---------------- */

  /** class 列表（避开 "unchecked" 这种含 checked 的坑） */
  function classTokens(node) {
    const raw = node && node.className;
    if (!raw) return [];
    if (typeof raw === 'string') return raw.split(/\s+/).filter(Boolean);
    if (raw.baseVal != null) return String(raw.baseVal).split(/\s+/).filter(Boolean);
    return [];
  }

  /**
   * 选中态类名（各版皮肤都可能用到）：
   *   check_answer / checkAnswer  —— 超星老考试页、作业页
   *   checked / selected / active / chosed / chosen —— 新版与预览页
   * 明确排除 unchecked / unselected 这类反向类名。
   */
  const SEL_TOKEN = /^(check_?answer|checked|selected|active|chosed|chosen|curSelected)$/i;

  function hasSelClass(node) {
    if (!node) return false;
    return classTokens(node).some((t) => !/^un/i.test(t) && SEL_TOKEN.test(t));
  }

  function inputOf(el) {
    if (!el) return null;
    const own = el.querySelector && el.querySelector('input[type="radio"], input[type="checkbox"]');
    if (own) return own;
    const host = el.parentElement;
    return (host && host.querySelector && host.querySelector('input[type="radio"], input[type="checkbox"]')) || null;
  }

  /**
   * 选项是否已选中。
   *
   * **只在"仅含这一个选项"的容器里查**（见 Scraper.optionScope）：
   * 超星考试页 .stem_answer 同时包住 A/B/C/D 四个 .answerBg，
   * 一旦往上找到 .stem_answer 的 `[class*="check_answer"]`，任意一个选项被选就会
   * 把四个都判成"已选"—— 多选的取消多余勾选因此一次都不执行（真机实测：
   * 正确答案 AB，页面留下 ACD）。
   */
  function sibsOf(q) {
    return ((q && q.options) || []).map((o) => o.el);
  }

  function isChecked(optionEl, siblings) {
    if (!optionEl) return false;
    const scope = (CXAI.Scraper.optionScope && CXAI.Scraper.optionScope(optionEl, siblings)) || optionEl;
    for (const node of [optionEl, scope]) {
      if (node && hasSelClass(node)) return true;
      if (node && node.getAttribute && node.getAttribute('aria-checked') === 'true') return true;
      if (node && node.hasAttribute && node.hasAttribute('checked')) return true;
    }
    try {
      if (scope.querySelector && scope.querySelector('[class*="check_answer"], [class*="checkAnswer"]')) return true;
    } catch (e) {}
    const inp = inputOf(optionEl);
    if (inp && (inp.checked || (inp.hasAttribute && inp.hasAttribute('checked')))) return true;
    return false;
  }

  /**
   * 选项状态指纹：类名链 + input.checked。
   * 页面用什么类名我们事先并不知道，"点完之后指纹变了"是唯一与皮肤无关的客观证据，
   * 用它代替"必须命中某个特定类名"的判定，可以避免"点了、页面也变了、但脚本仍认为没选中"
   * 从而连环补点、把已选 toggle 掉的情况。
   */
  function stateSig(optionEl) {
    if (!optionEl) return '';
    const chain = [optionEl, optionEl.parentElement, optionEl.parentElement && optionEl.parentElement.parentElement].filter(Boolean);
    const parts = chain.map((n) => classTokens(n).join('.'));
    const inp = inputOf(optionEl);
    parts.push(inp ? String(!!inp.checked) + '@' + (inp.getAttribute('checked') || '') : '-');
    return parts.join('|');
  }

  async function waitChecked(optionEl, timeoutMs, siblings) {
    const deadline = Date.now() + (timeoutMs || 1200);
    while (Date.now() < deadline) {
      if (isChecked(optionEl, siblings)) return true;
      await sleep(80);
    }
    return isChecked(optionEl, siblings);
  }

  /* ---------------- 选择题 ---------------- */

  /** 元素是否还挂在文档上：单题模式页面会在 AI 请求期间重绘，旧引用会失效 */
  function isLive(el) {
    if (!el) return false;
    try {
      if (el.isConnected === true) return true;
      if (typeof document.contains === 'function') return document.contains(el);
    } catch (e) {}
    // 判断不了就当它是活的：点一下没反应也不会有副作用，验收那步会兜住
    return true;
  }

  function innerInput(opt) {
    const el = opt.el;
    const own = el.querySelector && el.querySelector('input[type="radio"], input[type="checkbox"]');
    if (own) return own;
    const host = el.parentElement;
    return (host && host.querySelector && host.querySelector('input[type="radio"], input[type="checkbox"]')) || null;
  }

  /**
   * 点击阶梯：从"最像人手"到"最像注入"，逐级尝试。
   * 单题模式实测最常见的两种失败是
   *   1) 页面事件委托挂在 a.answerBg / li 上，点 .answer_p 不冒到 handler；
   *   2) 页面用 jQuery 绑定，原生 click 不触发（需要 .trigger('click')）。
   */
  /** 找选项/祖先上的行内 onclick 代码，用于直接调用页面自己的选中函数 */
  function pageFnOf(el) {
    let p = el;
    for (let i = 0; i < 5 && p; i++) {
      const attr = p.getAttribute ? p.getAttribute('onclick') : null;
      if (attr && /[A-Za-z_$][\w$]*\s*\(/.test(attr)) return { node: p, code: attr.trim() };
      p = p.parentElement;
    }
    return null;
  }

  /**
   * 点击目标阶梯。顺序对齐 ocsjs：**先点选项元素本身**（ocsjs 就是 `option.click()`，
   * option 取的是 `.answerBg .answer_p / .textDIV / .eidtDiv`），页面自己的 handler 跑不通
   * 再退到行内 onclick 函数、容器、input。
   * 每一步都与上一步不同节点，绝不重复点同一个位置。
   */
  function clickPlan(opt) {
    const el = opt.el;
    const plan = [];
    const seen = [];
    const add = (kind, node, label) => {
      if (!node || seen.indexOf(node) >= 0) return;
      seen.push(node);
      plan.push({ kind, el: node, label });
    };

    add('human', el, 'self');
    const pf = pageFnOf(el);
    if (pf) plan.push({ kind: 'pagefn', el: pf.node, code: pf.code, label: 'page-fn' });
    // 页面把状态挂在容器上（answerBg / li / label）时，补一次容器点击
    let p = el;
    for (let i = 0; i < 3 && p; i++) {
      p = p.parentElement;
      if (!p) break;
      if (/^(LI|LABEL|A)$/.test(p.tagName) || /answerBg|answer_bg|answerItem|option|chose/i.test(String(p.className || ''))) {
        add('human', p, 'anc:' + p.tagName.toLowerCase());
        break;
      }
    }
    add('native', innerInput(opt), 'input');
    add('jquery', el.parentElement || el, 'jq:self');
    add('hit', el, 'hit-test');
    return plan;
  }

  async function perform(step) {
    // 注意：这里不因为"看起来脱离文档"就跳过。派发事件给游离节点没有任何副作用，
    // 而 isLive() 在部分页面/沙箱环境下会误判，导致一次点击都发不出去（v1.4.2 的教训）。
    if (!step || !step.el) return false;
    try {
      if (step.kind === 'native') {
        step.el.click();
        return true;
      }
      if (step.kind === 'hit') {
        // 选项被透明遮罩/浮层盖住时，事件会落到命中元素上，这里改点真正的命中元素
        if (typeof document.elementFromPoint !== 'function') return false;
        const r = step.el.getBoundingClientRect();
        const x = Math.round(r.left + r.width / 2);
        const y = Math.round(r.top + r.height / 2);
        const hit = document.elementFromPoint(x, y);
        if (!hit || hit === step.el) return false;
        await humanClick(hit, { nativeFallback: true });
        return true;
      }
      if (step.kind === 'pagefn') {
        const win = typeof unsafeWindow !== 'undefined' && unsafeWindow ? unsafeWindow : window;
        const m = /^([A-Za-z_$][\w$]*)\s*\(/.exec(step.code || '');
        const fn = m && win[m[1]];
        if (typeof fn !== 'function') return false;
        fn.call(win, step.el, window.event);
        return true;
      }
      if (step.kind === 'jquery') {
        const jq = window.jQuery || (typeof unsafeWindow !== 'undefined' && unsafeWindow.jQuery);
        if (typeof jq !== 'function') return false;
        jq(step.el).trigger('click');
        return true;
      }
      await humanClick(step.el, { nativeFallback: true });
      return true;
    } catch (e) {
      return false;
    }
  }

  /** 用抓取器重新读一遍页面，判断答案是否真的落到 DOM 上（最可靠的验收） */
  function freshAnswered(q, keys) {
    try {
      const list = (CXAI.Scraper.collect() || {}).questions || [];
      if (!list.length) return false;
      const target = CXAI.Scraper.pickSame(list, q);
      if (!target) return false;
      const sibs = sibsOf(target);
      return (keys || []).some((k) => {
        const o = target.options.filter((x) => x.key === k)[0];
        return !!(o && (o.answered || isChecked(o.el, sibs)));
      });
    } catch (e) {
      return false;
    }
  }

  /** 失败时把选项的祖先结构记下来，方便定位是哪套页面皮肤 */
  function domSignature(opt) {
    const out = [];
    let p = opt && opt.el;
    for (let i = 0; i < 5 && p; i++) {
      out.push(p.tagName.toLowerCase() + (p.className ? '.' + String(p.className).trim().split(/\s+/).slice(0, 2).join('.') : ''));
      p = p.parentElement;
    }
    return out.join(' < ');
  }

  /**
   * 处理一道选择题。
   * @returns {Promise<{ok:boolean, clicked:string[], strategy:string, error?:string}>}
   */
  /** 页面上当前真实的答案串：优先页面自己的隐藏域（#answer{qid}/answers{qid}），退回选中标记 */
  function currentKeys(q) {
    try {
      const v = CXAI.Scraper.pageValue(q);
      if (v && v.value && /^[A-H]+$/i.test(v.value)) return v.value.toUpperCase();
    } catch (e) {}
    return CXAI.Scraper.selectedKeys(q);
  }

  async function answerChoice(q, keys, opts) {
    opts = opts || {};
    const sibs = sibsOf(q);
    const want = (keys || []).filter((k) => q.options.some((o) => o.key === k)).sort();
    if (!want.length) return { ok: false, clicked: [], strategy: 'none', error: '答案选项不存在' };
    if (q.type === 'single' || q.type === 'judgement') {
      // 单选/判断只取第一个：页面自身是单值语义，点新的会自动取消旧的
      const r = await clickOne(q, want[0], opts);
      const actual = currentKeys(q);
      return Object.assign({}, r, { actual, ok: !!(r && r.ok) && actual.indexOf(want[0]) >= 0 });
    }

    // 多选：以页面真实答案做差量 —— 只补缺的、只取消多的。
    // 之前靠 isChecked 判断，而 isChecked 会在 .stem_answer 层看到别的选项的勾，
    // 于是"已有的全跳过、多余的全不改"，最后留下 ACD（正确答案 AB）。
    const before = currentKeys(q);
    const clicked = [];
    const add = want.filter((k) => before.indexOf(k) < 0);
    const del = opts.clearExtra === false
      ? []
      : before.split('').filter((k) => k && want.indexOf(k) < 0);

    for (const k of add) {
      const opt = q.options.filter((o) => o.key === k)[0];
      if (!opt) return { ok: false, clicked, strategy: 'multi', error: '选项缺失' };
      const r = await clickOne(q, k, opts);
      if (!r.ok) return { ok: false, clicked, strategy: r.strategy, error: r.error, dom: r.dom, actual: currentKeys(q) };
      clicked.push(k);
      await sleep(CXAI.U.randInt(220, 620));
    }
    for (const k of del) {
      const opt = q.options.filter((o) => o.key === k)[0];
      if (!opt) continue;
      // 取消勾选也必须真的点一下（toggle 语义），点完以页面答案为准
      const r = await clickOne(q, k, Object.assign({}, opts, { deselect: true }));
      clicked.push('-' + k);
      if (!r.ok) break;
      await sleep(CXAI.U.randInt(180, 420));
    }

    let actual = currentKeys(q);
    // 差量点完还不对 → 按"逐项对齐"再补一轮（页面对 toggle 有节流时会出现）
    if (actual !== want.join('')) {
      for (const k of want) {
        if (actual.indexOf(k) >= 0) continue;
        const r = await clickOne(q, k, opts);
        if (!r.ok) break;
        actual = currentKeys(q);
        if (actual.indexOf(k) >= 0) clicked.push(k);
        await sleep(CXAI.U.randInt(160, 380));
      }
    }
    const ok = want.every((k) => actual.indexOf(k) >= 0) && (opts.clearExtra === false || actual.length === want.length);
    return { ok, clicked, strategy: 'multi', actual };
  }

  /**
   * 文本兜底：拿着答案选项的文字，重新从页面上抓一遍题，按文字找元素再点。
   * 单题模式页面会重绘，原引用失效时这条路径能把答案落到新元素上。
   */
  async function retryByText(q, keys) {
    const norm = (t) => CXAI.U.normText(t || '');
    const wanted = (keys || [])
      .map((k) => {
        const o = q.options.filter((x) => x.key === k)[0];
        return o ? norm(o.text) : '';
      })
      .filter(Boolean);
    if (!wanted.length) return null;
    let list = [];
    try {
      list = (CXAI.Scraper.collect() || {}).questions || [];
    } catch (e) {
      return null;
    }
    const target = CXAI.Scraper.pickSame(list, q);
    if (!target || !target.options.length) return null;

    const picked = [];
    for (const t of wanted) {
      let opt = target.options.filter((o) => norm(o.text) === t)[0];
      if (!opt) {
        const short = t.slice(0, 12);
        opt = target.options.filter((o) => short && norm(o.text).indexOf(short) >= 0)[0];
      }
      if (!opt) return null;
      const r = await clickOne(target, opt.key, {});
      if (!r.ok) return { ok: false, clicked: picked, strategy: 'by-text', error: r.error, dom: r.dom };
      picked.push(opt.key);
      await sleep(CXAI.U.randInt(200, 460));
    }
    if (target.type === 'single' || target.type === 'judgement') {
      // 单选只认第一个
      return { ok: picked.length > 0, clicked: picked, strategy: 'by-text' };
    }
    return { ok: picked.length === wanted.length, clicked: picked, strategy: 'by-text' };
  }

  /**
   * 把某个选项点到"页面上确实处于选中态"。
   *
   * 复用 ocsjs 被长期验证正确的三条：
   *   1) 用原生 el.click() 让页面自己的 handler 跑（不代劳改 DOM、不伪造状态）；
   *   2) 点一次就等 ~500ms 再看结果，不在同一次操作里连点；
   *   3) 已经选中就跳过，绝不重复点（toggle 语义的选项一点第二次就回到未选）。
   *
   * 在三条之上只加一件事：**状态指纹比对**。
   * 页面用 check_answer 也好、只改 input.checked 也好、换成别的类名也好，
   * 只要点完之后指纹和点之前不同，就认定这一下生效了，立刻收手。
   * 这样既不会因为"类名不认识"而连环补点，也不会把选中态 toggle 掉。
   */
  async function clickOne(q, key, opts) {
    opts = opts || {};
    const opt = q.options.filter((o) => o.key === key)[0];
    if (!opt) return { ok: false, clicked: [], strategy: 'none', error: '选项缺失' };

    // 已选中 → 直接过（ocsjs 的 if 判断就是这一条：已选不再点）
    // 例外：opts.deselect（多选里要取消多余勾选）时必须真的点一下
    const sibs = sibsOf(q);
    if (!opts.deselect && isChecked(opt.el, sibs)) return { ok: true, clicked: [key], strategy: 'already' };

    const settleMs = Number(opts.settleMs || 520); // ocsjs: await $.sleep(500)
    const sigBefore = stateSig(opt.el);
    const plan = clickPlan(opt);
    const tried = [];
    let maxSteps = Number(opts.maxSteps || 3);

    for (const step of plan) {
      if (tried.filter((t) => t.indexOf('(跳过)') < 0).length >= maxSteps) break;
      const did = await perform(step);
      tried.push(step.label + (did ? '' : '(跳过)'));
      if (!did) continue;

      await sleep(settleMs); // 只等一次，不在这里做任何补点

      const picked = isChecked(opt.el, sibs);
      const changed = stateSig(opt.el) !== sigBefore;
      if (picked || changed) {
        return { ok: true, clicked: [key], strategy: step.label + (changed && !picked ? '+sig' : '') };
      }
      // 完全没有变化 → 说明这一下没打到 handler，才换下一个目标（换的是不同节点）
      await sleep(CXAI.U.randInt(120, 260));
    }

    let probe = '';
    try {
      const r = opt.el.getBoundingClientRect ? opt.el.getBoundingClientRect() : null;
      probe =
        'live=' + isLive(opt.el) +
        ' conn=' + opt.el.isConnected +
        ' rect=' + (r ? Math.round(r.width) + 'x' + Math.round(r.height) : '?') +
        ' cls=' + (opt.el.className || '-') +
        ' sig=' + sigBefore +
        ' now=' + stateSig(opt.el);
    } catch (e) {
      probe = 'probe 失败：' + e.message;
    }
    return {
      ok: false,
      clicked: [],
      strategy: 'failed',
      error: '点击后页面无任何变化（试过 ' + tried.slice(0, 6).join(' / ') + '）',
      dom: domSignature(opt) + ' ｜ ' + probe
    };
  }

  /**
   * 点完之后的"落库窗口"。
   *
   * 超星各版本收集答案的时机不同：作业页要点每题自带的保存按钮，考试页多在
   * 点击后异步 POST、翻页前再由页面统一保存。原实现在 clickOne 成功后立刻点
   * "下一题"，等于抢在页面把答案写进内部状态之前换题 —— 表现就是"选项看着是选中的，
   * 交卷/回看却是 0 题"。
   *
   * 这里做两件事：有保存按钮就点一次；再留一段固定静默期给页面的 AJAX 落库。
   */
  async function settle(q, minMs) {
    let saved = false;
    try {
      const btn =
        (q && q.root && q.root.querySelector('[onclick*="saveQuestion"], .saveQuestion, [class*="save_btn"], .savebtndiv, [class*="savebtn"]')) ||
        document.querySelector('[onclick*="saveQuestion"], .saveQuestion');
      if (btn) {
        await clickOnce(btn);
        saved = true;
      }
    } catch (e) {}
    const wait = Math.max(Number(minMs || 0), Number(CXAI.Cfg.get('apply.settleMs', 900)) || 900);
    await sleep(wait);
    return { saved, waited: wait };
  }

  /* ---------------- 填空题 ---------------- */

  /** 给原生输入框写值，模拟键盘输入末尾的事件序列 */
  function setNativeValue(el, value) {
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const desc = Object.getOwnPropertyDescriptor(proto, 'value');
    if (desc && desc.set) desc.set.call(el, value);
    else el.value = value;
    fire(el, 'keydown');
    fire(el, 'input');
    fire(el, 'keyup');
    fire(el, 'change');
    fire(el, 'blur');
  }

  /** 富文本 iframe（有道/超星自带编辑器）写入 */
  function setFrameValue(frame, value) {
    const doc = frame.contentDocument;
    if (!doc) return false;
    const body = doc.body;
    if (!body) return false;
    body.innerHTML = String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\n/g, '<br>');
    try {
      body.dispatchEvent(new doc.defaultView.Event('input', { bubbles: true }));
      body.dispatchEvent(new doc.defaultView.Event('keyup', { bubbles: true }));
    } catch (e) {}
    return true;
  }

  /** 逐字符"打字"，让 input 事件序列看起来像真人 */
  async function typeInto(el, text, opts) {
    opts = opts || {};
    const target = String(text == null ? '' : text);
    if (opts.instant) {
      setNativeValue(el, target);
      return true;
    }
    try {
      el.focus();
    } catch (e) {}
    setNativeValue(el, '');
    const step = Math.max(1, Math.ceil(target.length / 24));
    let cur = '';
    for (let i = 0; i < target.length; i += step) {
      cur = target.slice(0, i + step);
      setNativeValue(el, cur);
      await sleep(CXAI.U.randInt(28, 90));
    }
    setNativeValue(el, target);
    return el.value === target;
  }

  function splitBlanks(text, count) {
    const t = String(text || '').trim();
    if (count <= 1) return [t];
    let parts = t.split(/\s*\|\|\|\s*/);
    if (parts.length === count) return parts;
    parts = t.split(/\s*[;；]\s*/);
    if (parts.length === count) return parts;
    // 数量对不上：整段塞第一个空，其余保持
    const out = new Array(count).fill('');
    out[0] = t;
    return out;
  }

  /* ---------------- 富文本（UEditor） ---------------- */

  /**
   * 找出这道题上的 UEditor 实例。
   * 超星填空/简答提交时走 setStuAnswerOfSomeQues() → UE.getEditor(id).sync()，
   * 而 sync() 取的是 **编辑器实例内部的内容**。v1.4.x 直接往 iframe.body 里写 HTML，
   * 编辑器实例并不知道，sync() 同步出去仍是空串 —— 这就是"填空/简答看着填了、系统里是 0"。
   */
  function editorList(q) {
    const out = [];
    const api = CXAI.Scraper.ueditorApi ? CXAI.Scraper.ueditorApi() : null;
    if (!api || !q) return out;
    const qid = q.qid || (CXAI.Scraper.qidOf ? CXAI.Scraper.qidOf(q.root) : '');
    // 顺序很重要：先页面上真实存在的 textarea（填空是 answerEditor{qid}N），
    // 再退到 answer{qid}（简答的编辑器 id）。反过来的话，UE.getEditor('answer{qid}')
    // 会为一个不存在的容器造出"空壳实例"（setContent 存在、body 为 null），
    // 写进去的内容会被 submitForm 里的 sync() 用空内容覆盖掉 —— 又变成"填了没交"。
    const ids = [];
    try {
      Array.from((q.root || document).querySelectorAll('textarea[id]')).forEach((ta) => {
        if (ids.indexOf(ta.id) < 0) ids.push(ta.id);
      });
    } catch (e) {}
    (q.inputs || []).forEach((el) => {
      if (!el || !el.id) return;
      const tag = String(el.tagName || '').toUpperCase();
      // 只认真正的表单控件。`q.inputs` 里还混着 UEditor 的 iframe（id 形如 ueditor_0），
      // 它不是编辑器 id —— 拿它去 getEditor 会造出一个"空壳实例"（setContent 有、body 是空壳），
      // 于是简答题被当成"两个空"，答案按 ||| 拆成两半，只写进去前半段。
      // 2026-11-17 实测：16 题整卷答案只落进 textarea 前 8 行。
      if (tag !== 'TEXTAREA' && tag !== 'INPUT') return;
      if (ids.indexOf(el.id) < 0) ids.push(el.id);
    });
    // 兜底：页面上一个 textarea 都没抓到，才按惯例试 answer{qid}
    if (!ids.length && qid) ids.push('answer' + qid);
    for (const id of ids) {
      try {
        const ed = api.getEditor(id);
        if (ed && typeof ed.setContent === 'function' && ed.body && out.indexOf(ed) < 0) out.push(ed);
      } catch (e) {}
    }
    return out;
  }

  function toEditorHtml(text) {
    return String(text == null ? '' : text)
      .split(/\r?\n/)
      .map((l) => '<p>' + l.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</p>')
      .join('');
  }

  /** 写入编辑器并 sync 回隐藏域，最后按编辑器内容验收 */
  function setEditorValue(ed, text) {
    if (!ed || typeof ed.setContent !== 'function') return false;
    try {
      if (typeof ed.focus === 'function') ed.focus();
    } catch (e) {}
    try {
      ed.setContent(toEditorHtml(text), false);
    } catch (e) {
      try {
        ed.setContent(toEditorHtml(text));
      } catch (e2) {
        return false;
      }
    }
    try {
      if (typeof ed.sync === 'function') ed.sync();
    } catch (e) {}
    try {
      if (typeof ed.fireEvent === 'function') {
        ed.fireEvent('contentChange');
        ed.fireEvent('selectionchange');
      }
    } catch (e) {}
    let got = '';
    try {
      got = ed.getPlainTxt ? ed.getPlainTxt() : String(ed.getContent() || '').replace(/<[^>]+>/g, ' ');
    } catch (e) {}
    const norm = (t) => String(t || '').replace(/\s+/g, '');
    const want = norm(String(text == null ? '' : text).slice(0, 24));
    return !!want && norm(got).indexOf(want) >= 0;
  }

  /**
   * 处理填空题 / 简答题。
   * @returns {Promise<{ok:boolean, filled:number, mode?:string, error?:string}>}
   */
  async function answerBlank(q, text, opts) {
    opts = opts || {};
    const eds = editorList(q);
    if (eds.length) {
      const parts = splitBlanks(text, eds.length);
      let filled = 0;
      for (let i = 0; i < eds.length; i++) {
        const val = parts[i] != null ? parts[i] : String(text || '');
        if (!val) continue;
        if (setEditorValue(eds[i], val)) filled++;
        await sleep(CXAI.U.randInt(160, 420));
      }
      if (filled) return { ok: true, filled, total: eds.length, mode: 'ueditor' };
    }
    const inputs = (q.inputs || []).filter((el) => el && el.isConnected);
    if (!inputs.length) {
      // 回退：从 root 里现找
      q.inputs = Array.from(q.root.querySelectorAll('textarea, input[type="text"], iframe')).filter((el) => !el.closest('.mark_answer'));
    }
    const list = (q.inputs || []).filter((el) => el && el.isConnected);
    if (!list.length) return { ok: false, filled: 0, error: '未找到输入框' };

    const parts = splitBlanks(text, list.length);
    let filled = 0;
    for (let i = 0; i < list.length; i++) {
      const el = list[i];
      const val = parts[i] != null ? parts[i] : parts[parts.length - 1] || '';
      if (!val) continue;
      if (el.tagName === 'IFRAME') {
        if (setFrameValue(el, val)) filled++;
      } else {
        const ok = await typeInto(el, val, opts);
        if (ok) filled++;
      }
      await sleep(CXAI.U.randInt(160, 420));
    }
    // 原生控件也回读一次：input 事件被页面重置时 typeInto 会"写成功但值是空"
    let got = 0;
    for (const el of list) {
      if (el.value != null && String(el.value).trim()) got++;
      else if (el.tagName === 'IFRAME') {
        try {
          if (el.contentDocument && el.contentDocument.body && (el.contentDocument.body.innerText || '').trim()) got++;
        } catch (e) {}
      }
    }
    if (got) filled = Math.max(filled, got);
    return { ok: filled > 0, filled, total: list.length, mode: 'native' };
  }

  /* ---------------- 统一入口 ---------------- */

  /**
   * 把一道题的判定结果写到页面上。
   * @param {object} q  题目对象
   * @param {object} result  CXAI.AI.solve 的返回
   */
  async function apply(q, result) {
    if (!q || !result) return { ok: false, error: '参数缺失' };
    const opts = {
      verifyMs: CXAI.Cfg.get('apply.verifyMs', 1100),
      clearExtra: CXAI.Cfg.get('apply.clearExtra', true),
      instant: CXAI.Cfg.get('apply.instantType', false)
    };
    if (q.type === 'completion' || q.type === 'line' || q.options.length === 0) {
      const r = await answerBlank(q, result.answerText, opts);
      let freshBlank = q;
      try {
        const l = (CXAI.Scraper.collect() || {}).questions || [];
        freshBlank = CXAI.Scraper.pickSame(l, q) || q;
      } catch (e) {}
      const liveText = (CXAI.Scraper.pageValue(freshBlank) || {}).value || '';
      return Object.assign({}, r, { actual: liveText, ok: !!(r && r.filled) || !!liveText });
    }
    if (q.type === 'judgement' && result.keys.length === 0 && q.options.length) {
      // 判断但答案没映射到 key：按文本再试一次
      const mapped = CXAI.AI.resolveAnswerKeys(result.answerText, q);
      if (mapped && mapped.keys.length) result.keys = mapped.keys;
    }
    let r = await answerChoice(q, result.keys, opts);
    if (!r || !r.ok) {
      // 兜底：元素可能已经被页面重绘换掉，按选项文字重新找一遍
      const again = await retryByText(q, result.keys);
      if (again && again.ok) r = again;
    }
    // 最终以页面自己的隐藏域为准（#answer{qid} / answers{qid}），这是"真的落盘了吗"的唯一客观证据。
    // 必须重新抓一遍：重绘后旧引用已经游离，读它只会得到空值（会误报"没落盘"）。
    let freshQ = q;
    try {
      const list = (CXAI.Scraper.collect() || {}).questions || [];
      freshQ = CXAI.Scraper.pickSame(list, q) || q;
    } catch (e) {}
    const live = (CXAI.Scraper.pageValue(freshQ) || {}).value || (r && r.actual) || '';
    const want = (result.keys || []).join('');
    return Object.assign({}, r || {}, {
      actual: live,
      ok: !!(r && r.ok) && (q.type === 'completion' ? !!live : (!!live && (want ? live.indexOf(want.split('')[0]) >= 0 : true)))
    });
  }

  /** 单题保存（部分考试页每题都有保存按钮） */
  async function saveOne(q) {
    const SEL = '[onclick*="saveQuestion"], .saveQuestion, [class*="save_btn"], .savebtndiv, [class*="savebtn"]';
    let node = (q.root && q.root.querySelector(SEL)) || document.querySelector(SEL);
    if (!node) return false;
    // 命中的常常是外层容器（超星整卷预览是 <div class="savebtndiv"><a onclick="saveQuestion(...)">保存</a></div>），
    // 直接点容器不会触发内部按钮的行为 —— 早先就是这样"点了但没保存"。这里往下找真正可点的那个。
    if (!node.hasAttribute('onclick') && !/^(A|BUTTON|INPUT)$/i.test(node.tagName)) {
      const inner = node.querySelector('[onclick], a, button, input[type="button"], input[type="submit"]');
      if (inner) node = inner;
    }
    await clickOnce(node);
    await sleep(CXAI.U.randInt(200, 500));
    return true;
  }

  /** 整卷提交按钮（默认只找不点，交给人工确认） */
  function findSubmitButton() {
    const patterns = [/交卷/, /提交试卷/, /提交答案/, /^提交$/];
    const nodes = Array.from(document.querySelectorAll('a,button,div,span')).filter((el) => {
      if (!el.offsetParent) return false;
      const t = (el.textContent || '').trim();
      if (t.length > 12) return false;
      return patterns.some((p) => p.test(t));
    });
    return nodes[0] || null;
  }

  return { humanClick, clickOnce, settle, apply, answerChoice, answerBlank, clickOne, isChecked, stateSig, saveOne, findSubmitButton, typeInto, fire };
})();