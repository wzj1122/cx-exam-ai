/* ---------------- 题目下方作答标注（页面内联结果） ----------------
 * 为什么需要：面板只有一个"选中题"的详情区，考生在页面上核对时得来回切；
 * 2026-11-18 需求：**每道题下方直接显示这题的作答结果**（答案 / 置信度 / 判定阶段 /
 * 依据 / 页面是否一致 / 失败原因）。
 *
 * 实现要点：
 *   · 每题一个 Shadow DOM 小卡片（页面 CSS 再野也污染不进来），挂在 q.root 末尾；
 *   · 只在内存里用 WeakMap 记 root → host，页面重绘后自动重建，不往存储里塞 DOM；
 *   · 任何异常都吞掉 —— 标注是"附加信息"，绝不能因为它让答题主流程中断。
 */

CXAI.Mark = (function () {
  const CSS = `
    :host { all: initial; display: block; }
    * { box-sizing: border-box; font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; }
    .m { margin: 6px 0 3px; padding: 5px 8px; border: 1px solid #e3e8f0; border-left: 3px solid #94a3b8;
      border-radius: 7px; background: #fbfcfe; font-size: 11.5px; line-height: 1.5; color: #1f2937; }
    .m.ok { border-left-color: #16a34a; background: #f7fdf9; }
    .m.warn { border-left-color: #d97706; background: #fffdf5; }
    .m.bad { border-left-color: #dc2626; background: #fff8f8; }
    .m.manual { border-left-color: #7c3aed; background: #fbf8ff; }
    .h { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
    .badge { flex: none; font-size: 10.5px; line-height: 17px; padding: 0 6px; border-radius: 4px;
      background: #eef2f8; color: #5b6472; border: 1px solid #e3e8f0; font-weight: 600; }
    .badge.ok { background: #e8f8ee; color: #15803d; border-color: #bfe6cd; }
    .badge.warn { background: #fdf6e3; color: #a16207; border-color: #f0e0b8; }
    .badge.bad { background: #fdeeee; color: #b91c1c; border-color: #f3c9c9; }
    .badge.manual { background: #f3edff; color: #6d28d9; border-color: #ddd0fb; }
    .ans { font-weight: 700; color: #1d4ed8; word-break: break-word; }
    .ans.ok { color: #15803d; }
    .ans.bad { color: #b91c1c; }
    .chip { flex: none; font-size: 10px; line-height: 16px; padding: 0 5px; border-radius: 4px;
      color: #5b6b86; background: #f2f5fa; border: 1px solid #e3e8f0; }
    .chip.low { color: #a16207; background: #fdf6e3; border-color: #f0e0b8; }
    .row { margin-top: 4px; display: flex; gap: 6px; align-items: baseline; }
    .k { flex: none; min-width: 46px; font-size: 10.5px; color: #98a1b0; }
    .v { flex: 1; min-width: 0; color: #374151; word-break: break-word; }
    .v.tight { display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
    .v em { font-style: normal; color: #2563eb; }
    .v.good { color: #15803d; } .v.bad { color: #b91c1c; }
    .vr { color: #5b6472; }
    .t { margin-top: 5px; font-size: 10px; color: #a3abb9; }
  `;

  let MAP = new WeakMap();
  let styleMissing = 0;
  // 每道题最后一次渲染的入参（key = qid 或题干指纹）。
  // 为什么必须有：超星点完选项/保存后经常把 .questionLi 整块重绘，标注节点跟着被丢掉，
  // 用户看到的就是"答完了但题下面什么都没有"（2026-11-18 真机实测）。
  // 有了这份存档就能在题块重建后把同一份结果原样贴回去。
  const LAST = new Map();

  function keyOf(q) {
    try {
      const qid = String((q && q.qid) || '');
      if (qid) return 'qid:' + qid;
      return 'stem:' + CXAI.U.normText((q && q.stem) || '').slice(0, 60);
    } catch (e) {
      return 'stem:?';
    }
  }

  function enabled() {
    // 2026-11-18 用户明确要求：作答详情只放在「双击小球打开的面板」里，
    // 页面上不要任何额外元素（那块卡片会挡题干、看起来像"悬浮窗"）。
    // 所以这里恒为 false —— 整个模块保留只是为了兼容旧调用与历史数据，
    // 任何真实渲染都不会发生。要恢复页内标注必须显式改这一行。
    return false;
  }

  function esc(t) {
    return CXAI.U.escapeHtml(String(t == null ? '' : t));
  }

  function hostOf(q, create) {
    if (!q || !q.root || !q.root.appendChild) return null;
    let host = MAP.get(q.root);
    // MAP 以 root 元素为键：页面重绘会换掉 root，新 root 自然拿到新 host。
    // 这里不再检查 parentNode / isConnected —— 垫片和真浏览器对这两个属性的实现不一致，
    // 用它们会把已挂好的节点误判成游离，进而每次 render 都新建一块（测试里表现为取不到文本）。
    if (host) return host;
    if (!create) return null;
    try {
      host = document.createElement('div');
      host.className = 'cxai-mark';
      host.setAttribute('data-cxai', 'mark');
      host.style.cssText = 'display:block;width:100%;clear:both;margin:0;padding:0;';
      const sh = host.attachShadow ? host.attachShadow({ mode: 'open' }) : null;
      const box = sh || host;
      const st = document.createElement('style');
      st.textContent = CSS;
      box.appendChild(st);
      const body = document.createElement('div');
      body.className = 'mb';
      box.appendChild(body);
      // 直接留一个正文引用：某些环境（离线测试的 DOM 垫片）attachShadow 不会回写 shadowRoot，
      // 只靠 shadowRoot.querySelector 会拿不到节点。
      try {
        host.__mb = body;
      } catch (e) {}
      q.root.appendChild(host);
      MAP.set(q.root, host);
      return host;
    } catch (e) {
      styleMissing++;
      return null;
    }
  }

  function bodyOf(host) {
    if (!host) return null;
    try {
      if (host.__mb) return host.__mb;
      const sh = host.shadowRoot;
      return sh ? sh.querySelector('.mb') : host.querySelector('.mb');
    } catch (e) {
      return null;
    }
  }

  function stageWord(s) {
    return (
      {
        panel: '议会投票',
        critique: '交叉复核',
        arbiter: '仲裁裁决',
        fallback: '加权兜底',
        rescue: '兜底重试',
        heuristic: '本地兜底',
        cached: '会话缓存',
        stored: '上次判定',
        stem: '题干自带',
        prefetch: '后台预判'
      }[s] || s || ''
    );
  }

  /** 字母答案顺手翻成选项文字：B → B（SYN + ACK） */
  function letterize(val, q) {
    const raw = String(val == null ? '' : val).trim();
    if (!raw) return '';
    const opts = (q && q.options) || [];
    if (!opts.length || !/^[A-Ha-h]+$/.test(raw)) return raw;
    return raw
      .toUpperCase()
      .split('')
      .map(function (c) {
        const o = opts.filter(function (x) {
          return String(x.key || '').toUpperCase() === c;
        })[0];
        if (!o) return c;
        const t = String(o.text || '').replace(/\s+/g, ' ').slice(0, 22);
        return c + '（' + t + '）';
      })
      .join('  ');
  }

  function clip(t, n) {
    const s = String(t == null ? '' : t).replace(/\s+/g, ' ').trim();
    return s.length > n ? s.slice(0, n) + '…' : s;
  }

  /** 页面答案与 AI 答案是否一致（选择题比字母串，文本题比包含关系） */
  function sameAnswer(ai, page, q) {
    const norm = (t) =>
      String(t == null ? '' : t)
        .replace(/[\s\u00a0]/g, '')
        .toUpperCase();
    const a = norm(ai);
    const b = norm(page);
    if (!a || !b) return false;
    if (a === b) return true;
    if (q && /^(completion|line|reader|fill|match|oral|listening)$/.test(String(q.type || ''))) {
      return a.indexOf(b) >= 0 || b.indexOf(a) >= 0;
    }
    return false;
  }

  function timeStr() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
  }

  function kv(k, vHtml, cls) {
    return (
      '<div class="row"><span class="k">' + esc(k) + '</span><span class="v ' + (cls || '') + '">' + vHtml + '</span></div>'
    );
  }

  /**
   * 渲染一题的作答结果。
   * @param {object} q   题目对象
   * @param {object} result  AI.solve 的返回（可为空）
   * @param {object} applied Apply.apply 的返回（可为空）
   * @param {object} [opt]  {status:'ok'|'fail'|'skip'|'pending'|'preview'|'manual', error, at}
   */
  function render(q, result, applied, opt) {
    try {
      if (!enabled()) return null;
      const host = hostOf(q, true);
      const body = bodyOf(host);
      if (!body) return null;
      opt = opt || {};
      const ok = applied ? !!applied.ok : opt.status === 'ok' || opt.status === 'skip';
      const manual = !!(applied && applied.manual) || opt.status === 'manual';
      const low = !!(result && (result.lowConfidence || (Number(result.confidence) || 0) < 0.55));
      let state = 'todo';
      let badge = 'AI 已作答';
      if (opt.status === 'pending') {
        state = '';
        badge = '待作答';
      } else if (opt.status === 'preview') {
        state = 'warn';
        badge = '已预判 · 未写入';
      } else if (opt.status === 'skip') {
        state = 'ok';
        badge = '已答 · 沿用页面';
      } else if (ok) {
        state = low ? 'warn' : 'ok';
        badge = low ? '已作答 · 存疑' : 'AI 已作答';
      } else if (manual) {
        state = 'manual';
        badge = '需人工填写';
      } else {
        state = 'bad';
        badge = '写入失败';
      }

      const answer = result && result.answerText ? String(result.answerText) : '';
      // 默认只留一行（状态 + 答案 + 置信度）；要看依据/投票/页面比对得显式开 ui.inlineResultDetail
      const detail = !!(function () {
        try {
          return CXAI.Cfg.get('ui.inlineResultDetail', false) === true;
        } catch (e) {
          return false;
        }
      })();
      const shown = answer ? letterize(answer, q) : '';
      const conf = result && result.confidence != null ? Math.round(Number(result.confidence) * 100) : 0;
      const stage = stageWord(result && result.stage);
      const pageVal = (opt.actual != null ? opt.actual : '') || (applied && applied.actual) || '';
      const parts = [];

      const chips = [];
      if (conf) chips.push('<span class="chip' + (low ? ' low' : '') + '">置信度 ' + conf + '%</span>');
      if (stage) chips.push('<span class="chip">' + esc(stage) + '</span>');
      if (result && result.vision && result.vision.mode && result.vision.mode !== 'none')
        chips.push('<span class="chip">读图 ' + esc(result.vision.mode) + '</span>');

      parts.push(
        '<div class="h"><span class="badge ' + state + '">' + esc(badge) + '</span>' +
          (shown
            ? '<span class="ans ' + (state === 'bad' ? 'bad' : state === 'ok' ? 'ok' : '') + '" title="' + esc(shown) + '">' +
              esc(clip(shown, 180)) + '</span>'
            : '') +
          chips.join('') +
          '</div>'
      );

      if (opt.status === 'pending') {
        parts.push(kv('说明', '还没开始判这道题', 'vr'));
      } else if (detail) {
        const reason = (result && result.reason) || '';
        if (reason) parts.push(kv('依据', esc(clip(reason, 160)), 'vr'));
        if (answer && result && result.keys && result.keys.length) {
          const vs = (result.votes || []).slice(0, 4).map(function (v) {
            const who = clip(v.who || '模型', 12);
            return esc(who + ' ' + (v.answer || '?') + ' ' + (v.confidence != null ? Math.round(v.confidence * 100) + '%' : ''));
          });
          if (vs.length) parts.push(kv('票', '<span class="vr">' + vs.join(' · ') + (result.votes.length > 4 ? ' …' : '') + '</span>'));
        }
        if (pageVal) {
          const same = sameAnswer(answer, pageVal, q);
          parts.push(
            kv('页面', esc(clip(pageVal, 120)) + ' <span class="chip' + (same ? '' : ' low') + '">' + (same ? '与 AI 一致' : '与 AI 不同') + '</span>')
          );
        } else if (state === 'bad') {
          parts.push(kv('原因', esc(clip((applied && applied.error) || opt.error || '页面没有可写入的位置', 150)), 'bad'));
        }
        if (manual && !(state === 'bad')) {
          parts.push(kv('原因', esc(clip((applied && applied.error) || opt.error || '这题没有输入框/选项，答案请手动填', 150)), 'vr'));
        }
        if (result && result.errors && result.errors.length) {
          parts.push(kv('降级', esc(clip(result.errors.slice(-1)[0], 110)), 'vr'));
        }
      }
      const tail = [];
      if (opt.at || result) tail.push('判定于 ' + timeStr());
      if (opt.status === 'skip') tail.push('AI 未参与');
      if (tail.length && detail) parts.push('<div class="t">' + esc(tail.join(' · ')) + '</div>');

      body.innerHTML = '<div class="m ' + state + '">' + parts.join('') + '</div>';
      // 存档：题块被重绘后 attachAll 靠它把同一份结果贴回去
      try {
        LAST.set(keyOf(q), {
          stem: (q && q.stem) || '',
          result: result || null,
          applied: applied || null,
          opt: opt
        });
      } catch (e) {}
      // 纯文本摘要：离线测试的 DOM 垫片不解析 innerHTML，这里顺手留一份，
      // textOf() 与日志排查都靠它（真实浏览器里两者一致）。
      try {
        host.__summary =
          String(body.textContent || '').replace(/\s+/g, ' ').trim() ||
          String(body.innerHTML || '')
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
      } catch (e) {}
      return host;
    } catch (e) {
      return null;
    }
  }

  /** 还没判：挂一条"待作答"，保证每道题下面都有位置 */
  function pending(q) {
    return render(q, null, null, { status: 'pending' });
  }

  /** 后台预取到答案（尚未写入页面） */
  function preview(q, result) {
    return render(q, result, null, { status: 'preview' });
  }

  /** 已答但 AI 没参与（页面上本来就有答案） */
  function existing(q, actual) {
    return render(
      q,
      { answerText: actual || '', confidence: null, stage: 'stored', keys: [] },
      { ok: true, actual: actual || '' },
      { status: 'skip', actual: actual || '' }
    );
  }

  function failed(q, msg, result) {
    return render(q, result || null, { ok: false, error: msg || '未知原因' }, { status: 'fail', error: msg });
  }

  /** 页面里所有题都挂上（幂等）：有存档的按存档回放结果，没存档的挂"待作答" */
  function attachAll(list) {
    try {
      if (!enabled()) return 0;
      let n = 0;
      (list || []).forEach(function (q) {
        const rec = LAST.get(keyOf(q));
        if (rec) {
          // 题块被重绘（超星点选项/保存后常见）：新 root 上还没有 host，这时按存档原样重建；
          // 已经有内容的就不动，免得每秒一次的补挂把 DOM 刷来刷去。
          const has = hostOf(q, false);
          const body = bodyOf(has);
          if (!(body && String(body.textContent || '').trim())) {
            render(q, rec.result, rec.applied, rec.opt);
            n++;
          }
          return;
        }
        const host = hostOf(q, true);
        if (!host) return;
        const body = bodyOf(host);
        if (!body) return;
        if (body.textContent && body.textContent.trim()) return;
        pending(q);
        n++;
      });
      return n;
    } catch (e) {
      return 0;
    }
  }

  function clearAll() {
    try {
      let n = 0;
      Array.from(document.querySelectorAll('.cxai-mark')).forEach(function (el) {
        try {
          if (el.parentNode) el.parentNode.removeChild(el);
        } catch (e) {}
        n++;
      });
      // 连带清掉索引，否则 textOf 还能从旧 host 里读到内容
      MAP = new WeakMap();
      LAST.clear();
      return n;
    } catch (e) {
      return 0;
    }
  }

  /** 调试/测试用：取某题标注的纯文本 */
  function textOf(q) {
    try {
      const host = hostOf(q, false);
      const body = bodyOf(host);
      const t = body ? String(body.textContent || '').replace(/\s+/g, ' ').trim() : '';
      return t || (host && host.__summary) || '';
    } catch (e) {
      return '';
    }
  }

  return { enabled, render, pending, preview, existing, failed, attachAll, clearAll, textOf, letterize, stageWord };
})();
