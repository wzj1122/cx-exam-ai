/* ---------------- 环境伪装与节流 ----------------
 * 考试页的常见干扰：
 *   1) 切屏 / 失焦检测（visibilitychange、blur、document.hidden）
 *   2) 定时弹窗确认（"是否继续作答"）
 *   3) 频率检测（同一秒内多点、等间隔点击）
 * 本模块按配置逐项处理，并给主循环提供"像人"的节奏。
 */

CXAI.Guard = (function () {
  let installed = false;
  let alertTimer = null;
  const patched = [];

  function on(obj, prop, value) {
    try {
      const desc = Object.getOwnPropertyDescriptor(obj, prop);
      Object.defineProperty(obj, prop, {
        configurable: true,
        get() {
          return typeof value === 'function' ? value() : value;
        },
        set() {}
      });
      patched.push(() => {
        try {
          if (desc) Object.defineProperty(obj, prop, desc);
          else delete obj[prop];
        } catch (e) {}
      });
    } catch (e) {}
  }

  /* ---------- 1. 前台伪装 ---------- */

  function patchVisibility() {
    on(document, 'hidden', false);
    on(document, 'visibilityState', 'visible');
    try {
      document.hasFocus = function () {
        return true;
      };
    } catch (e) {}
    // 吞掉可见性/失焦事件，避免上报"切屏次数"
    const killer = (e) => {
      if (e.type === 'visibilitychange' || e.type === 'blur' || e.type === 'pagehide' || e.type === 'freeze') {
        e.stopImmediatePropagation();
        e.stopPropagation();
      }
    };
    ['visibilitychange', 'blur', 'pagehide', 'freeze', 'webkitvisibilitychange'].forEach((t) => {
      window.addEventListener(t, killer, true);
      document.addEventListener(t, killer, true);
    });
    window.addEventListener('focus', () => {}, true);
  }

  /* ---------- 2. 防调试噪音 ---------- */

  function patchDebugger() {
    if (!CXAI.Cfg.get('guard.blockDevtools', true)) return;
    // 屏蔽极高频率的 debugger 陷阱（只处理 setInterval/setTimeout 里的函数体）
    const rawSetInterval = window.setInterval;
    window.setInterval = function (fn, ms) {
      if (typeof fn === 'function' && /debugger/.test(fn.toString())) return 0;
      return rawSetInterval.apply(window, arguments);
    };
    // 关掉右键/复制限制这类常见的小动作（会挡住自己的 UI）
    document.addEventListener(
      'contextmenu',
      (e) => {
        e.stopImmediatePropagation();
      },
      true
    );
  }

  /* ---------- 3. 弹窗自动确认 ---------- */

  /**
   * 弹窗处理：**不抢在用户前面点**。
   *
   * 有些弹窗里是可能要看的信息（提交确认、分数提示、是否继续作答……），立刻点掉
   * 等于把有用的东西一起关掉。所以改成：
   *   1) 弹窗出现只记时间，谁都不点；
   *   2) 等够 `guard.dialogDelaySec` 秒（默认 10，可在设置里改；0 = 永不自动点）；
   *   3) 期间你自己关掉了 → 元素消失，什么都不做；
   *   4) 一直没关才点一下，并记一条日志。
   * 交卷 / 提交试卷类按钮永远不在名单里。
   */
  const seen = new WeakMap();

  function dismissDialogs() {
    let clicked = 0;
    const delaySec = Number(CXAI.Cfg.get('guard.dialogDelaySec', 10));
    if (!(delaySec > 0)) {
      // 0 = 只手动关，连计时都不做
      return 0;
    }
    const killers = [/继续作答/, /继续考试/, /离开/, /确定/, /知道了/, /继续/];
    const nodes = Array.from(document.querySelectorAll('.layui-layer-btn a, .dialog-btn, .btn, button, a, .popup-btn, [class*="confirm"]'));
    const now = Date.now();
    const visible = (el) => {
      // 不能用 offsetParent 判可见：fixed 定位的弹窗（超星大量使用）offsetParent 恒为 null，
      // 会被误判成"不可见"而永远不关。getClientRects 对 fixed 也有效。
      try {
        if (el.getClientRects && el.getClientRects().length > 0) return true;
      } catch (e) {}
      return !!el.offsetParent;
    };
    for (const el of nodes) {
      if (!visible(el)) {
        seen.delete(el);
        continue;
      }
      const t = (el.textContent || '').trim();
      if (!t || t.length > 10) continue;
      if (!killers.some((p) => p.test(t))) continue;
      // 交卷 / 提交试卷类按钮，任何时候都不自动点
      if (/交卷|提交试卷|确定提交|结束考试/.test(t)) continue;
      const first = seen.get(el);
      if (!first) {
        seen.set(el, now);
        CXAI.Log.info('发现弹窗「' + t + '」，' + delaySec + ' 秒内你不关我再自动关');
        continue;
      }
      if (now - first < delaySec * 1000) continue;
      try {
        el.click();
        clicked++;
        CXAI.Log.warn('弹窗「' + t + '」已 ' + delaySec + ' 秒未处理，自动关闭');
      } catch (e) {}
      seen.delete(el);
    }
    return clicked;
  }

  function startAlertWatcher() {
    if (alertTimer) return;
    alertTimer = setInterval(() => {
      try {
        dismissDialogs();
      } catch (e) {}
    }, 1500);
  }

  /* ---------- 4. 原生 confirm / alert 接管 ---------- */

  function patchNativeDialog() {
    if (!CXAI.Cfg.get('guard.autoConfirm', true)) return;
    try {
      const rawConfirm = window.confirm.bind(window);
      window.confirm = function (msg) {
        const text = String(msg == null ? '' : msg);
        // 交卷 / 提交试卷这类确认，脚本自己没在跑自动交卷时**不要替用户点掉**：
        // 该看到的提示要能看到（用户明确提过"有些弹窗可能是我们需要的"）。
        const risky = /交卷|提交试卷|提交答案|结束考试|确认提交/.test(text);
        const auto = CXAI.Cfg.get('apply.autoSubmit', false) || CXAI.Cfg.get('apply.submit', false);
        if (risky && !auto) {
          CXAI.Log.warn('这是交卷确认，交给你自己点：' + text.slice(0, 80));
          try {
            return rawConfirm(msg);
          } catch (e) {
            return false;
          }
        }
        CXAI.Log.warn('已自动确认 confirm：' + text.slice(0, 80));
        return true;
      };
      window.alert = function (msg) {
        CXAI.Log.info('已吞掉 alert：' + String(msg).slice(0, 80));
      };
    } catch (e) {}
  }

  /* ---------- 5. 节奏控制 ---------- */

  /**
   * 下一题之前的等待时间。人工答题不会匀速，这里用
   * "基础间隔 × 抖动 + 概率性长停顿" 模拟。
   */
  function pace(index) {
    const min = CXAI.Cfg.get('guard.minDelay', 1400);
    const max = CXAI.Cfg.get('guard.maxDelay', 4200);
    let wait = CXAI.U.randInt(min, max);
    // 每 5~8 题插入一次较长停顿（喝水、抬头）
    const every = CXAI.Cfg.get('guard.longBreakEvery', 6);
    if (every > 0 && index > 0 && index % every === 0) {
      wait += CXAI.U.randInt(4000, 9000);
      CXAI.Log.info(`第 ${index} 题后长停顿 ${Math.round(wait / 1000)}s`);
    }
    // 偶发 3% 概率的额外犹豫
    if (Math.random() < 0.03) wait += CXAI.U.randInt(3000, 7000);
    return wait;
  }

  /* ---------- 对外 ---------- */

  function install() {
    if (installed) return;
    installed = true;
    if (CXAI.Cfg.get('guard.enabled', true)) {
      patchVisibility();
      patchDebugger();
      patchNativeDialog();
      startAlertWatcher();
      CXAI.Log.ok('环境伪装已启用（前台保持 / 弹窗自动确认 / 节奏抖动）');
    } else {
      CXAI.Log.warn('环境伪装未启用');
    }
  }

  function uninstall() {
    patched.forEach((fn) => fn());
    patched.length = 0;
    if (alertTimer) clearInterval(alertTimer);
    alertTimer = null;
    installed = false;
  }

  return { install, uninstall, pace, dismissDialogs, installed: () => installed };
})();