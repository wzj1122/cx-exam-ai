/* ---------------- 主编排引擎 ----------------
 * 两种页面形态：
 *   whole   整卷渲染（所有 .questionLi 同时在 DOM 里）→ 顺序遍历
 *   single  单题模式（一次只渲染一题）→ 答完点"下一题"循环
 * 判题靠 CXAI.AI.solve（多重 AI），落盘靠 CXAI.Apply。
 */

CXAI.Engine = (function () {
  const st = {
    running: false,
    paused: false,
    haltReason: '',
    stopped: false,
    cursor: 0,
    cache: new Map(),
    results: [],
    skipped: 0,
    failed: 0,
    startedAt: 0,
    // 单题模式是整页导航（getTheNextQuestion → submitForm → location.href），
    // 每翻一页脚本内存就清零一次。已答题数必须从会话存储里累加，否则面板永远显示 0。
    baseDone: 0,
    // 跨页记录每道题被处理过几次：来回弹（比如误点"上一题"）靠它兜底
    visited: {},
    // 题量（页面右上"题量: N"）。单题模式下页面只有一个题块，不能拿 .questionLi 数当题量
    total: 0,
    // 这一程是否已经尝试切到"整卷预览"（防来回跳）
    previewTried: false,
    // 预取状态
    prefetching: false,
    prefetchPromise: null,
    // 切整卷预览 = 主动把活交接给下一页，finally 不能把 running 标记清掉，
    // 否则新页面 boot 读不到"上次还在跑"，就再也不会自动开始（用户实测的问题）
    handoff: false
  };

  function sleep(...a) {
    return CXAI.U.sleep(...a);
  }

  /* ---------------- 会话断点（页面刷新后能接着答） ---------------- */

  const SESSION_KEY = 'session';

  function saveSession(running) {
    try {
      CXAI.Store.set(SESSION_KEY, {
        running: running !== false && st.running,
        startedAt: st.startedAt,
        done: appliedCount() + st.skipped,
        failed: st.failed,
        visited: st.visited || {},
        previewTried: st.previewTried || false,
        url: location.href,
        at: Date.now()
      });
    } catch (e) {}
  }

  function assertAlive() {
    if (st.stopped) throw new Error('__STOPPED__');
    return true;
  }

  /** 暂停点：在每题开始前等待恢复 */
  async function waitIfPaused() {
    while (st.paused && !st.stopped) await sleep(300);
    assertAlive();
  }

  /**
   * 会话/持久缓存键。
   * 纯图片题的题干和选项文字都是空的（题面全在图里），只按文字算键会让第二题
   * 直接命中第一题的结论（真机踩过：#2 命中缓存，模型根本没被调用）。
   * 所以把图片地址也拼进去；有 qid 的再加一道 qid 兜底。
   */
  function cacheKey(q) {
    const imgs = (q.images || []).join(',');
    return [
      CXAI.U.normText(q.stem || ''),
      (q.options || []).map((o) => CXAI.U.normText(o.text || '')).join('|'),
      imgs
    ].join('||');
  }

  /* ---------------- 单题处理 ---------------- */

  /** 落盘前重新从页面取一次题目：单题模式页面会在判题期间重绘，旧元素引用会失效 */
  function relive(q) {
    try {
      const list = (CXAI.Scraper.collect() || {}).questions || [];
      const hit = CXAI.Scraper.pickSame(list, q);
      if (!hit || !hit.options.length) return q;
      hit.index = q.index;
      return hit;
    } catch (e) {
      return q;
    }
  }

  /** 把一道题的结论写进面板清单（跨页持久化），同时读回页面真实选中态做对比 */
  function recordQ(q, result, applied, status) {
    try {
      const live = (CXAI.Scraper.pageValue(q) || {}).value || '';
      CXAI.UI.pushQuestion({
        index: q.no || (Number(q.index) || 0) + 1,
        qid: q.qid || '',
        type: q.type || '',
        typeLabel: q.typeLabel || '',
        stem: CXAI.U.truncate(q.stem || '', 240),
        options: (q.options || []).slice(0, 10).map((o) => ({ k: o.key, t: CXAI.U.truncate(o.text || '', 60), a: !!o.answered })),
        answer: result && result.answerText ? String(result.answerText) : '',
        actual: live,
        stage: result && result.stage ? result.stage : '',
        confidence: result && result.confidence != null ? result.confidence : null,
        status: status,
        // 用题号（qid）当主键：同一道题翻回来还是同一行，不会堆成两条
        key: q.qid ? 'qid:' + q.qid : 'stem:' + (CXAI.U.normText(q.stem || '').slice(0, 40) || 'i' + (Number(q.index) || 0))
      });
    } catch (e) {}
  }

  /* ---------------- 判题结果的跨页缓存 ----------------
   * 单题模式一旦整页重载，内存里的 st.cache 就没了；而面板要"每题都显示 AI 答案"、
   * 续跑时也不该为同一题重复烧 token。所以按题号落一份到存储里。
   */
  const ANSWERS_KEY = 'answers';

  function readAnswers() {
    try {
      const m = CXAI.Store.get(ANSWERS_KEY, null);
      return m && typeof m === 'object' ? m : {};
    } catch (e) {
      return {};
    }
  }

  function saveAnswer(q, result) {
    if (!q || !result) return;
    try {
      const all = readAnswers();
      const id = q.qid || CXAI.U.normText(q.stem || '').slice(0, 40);
      if (!id) return;
      all[id] = {
        keys: (result.keys || []).slice(),
        answerText: result.answerText || '',
        confidence: result.confidence || 0,
        stage: result.stage || '',
        stem: CXAI.U.truncate(q.stem || '', 90),
        typeLabel: q.typeLabel || '',
        no: q.no || 0,
        at: Date.now()
      };
      CXAI.Store.set(ANSWERS_KEY, all);
    } catch (e) {}
  }

  function cachedAnswer(q) {
    try {
      const all = readAnswers();
      const id = q.qid || CXAI.U.normText(q.stem || '').slice(0, 40);
      const hit = id && all[id];
      if (!hit || !hit.answerText) return null;
      return Object.assign({ votes: [], ratio: null }, hit, { stage: 'stored' });
    } catch (e) {
      return null;
    }
  }

  /** 题干自带答案（本题选AB / 答案：B）就直接用，别让模型把明写的答案改掉 */
  function stemResult(q) {
    const keys = CXAI.Scraper.stemAnswerKeys ? CXAI.Scraper.stemAnswerKeys(q.stem, q.options) : [];
    if (!keys.length) return null;
    return {
      keys: keys.slice(),
      answerText: keys.join(''),
      confidence: 1,
      ratio: 1,
      stage: 'stem',
      votes: [],
      reason: '题干自带答案'
    };
  }

  async function handleQuestion(q, pageKind) {
    const overwrite = CXAI.Cfg.get('apply.overwriteAnswered', false);
    const no = q.no || (Number(q.index) || 0) + 1;
    const liveBefore = (CXAI.Scraper.pageValue(q) || {}).value || '';

    // 页面已经答过、又不想覆盖时，先看是否"答错了"：答错才重做（apply.fixWrong 默认开），
    // 答对就跳过。之前是一律跳过，于是上一轮写错的 ACD 永远修不回来。
    const fixWrong = CXAI.Cfg.get('apply.fixWrong', true);

    const ck = cacheKey(q);
    let result = null;
    const sr = stemResult(q);
    if (sr) {
      result = sr;
      CXAI.Log.info(`#${no} 题干自带答案 ${sr.answerText}，直接采用`);
    } else if (st.cache.has(ck) && !overwrite) {
      result = Object.assign({}, st.cache.get(ck), { stage: 'cached' });
      CXAI.Log.info(`#${no} 命中本次会话缓存`);
    } else {
      const stored = overwrite ? null : cachedAnswer(q);
      if (stored) {
        result = stored;
        CXAI.Log.info(`#${no} 命中上次的判定结果 ${stored.answerText}`);
      }
    }

    // 判断题页面存 true/false，AI 给 A/B：比较前统一折算成字母串
    const aiKeys = result
      ? ((result.keys && result.keys.length)
          ? result.keys.join('')
          : (CXAI.AI.resolveAnswerKeys(result.answerText, q).keys || []).join(''))
      : '';
    if (q.answered && !overwrite) {
      const norm = (v) => CXAI.U.normText(String(v == null ? '' : v).replace(/<[^>]+>/g, ' '));
      // 选择题比字母串；填空/简答比文本（两边都洗成纯文本再比）
      const same = q.type === 'completion'
        ? !!result && !!norm(result.answerText) && (norm(liveBefore).indexOf(norm(result.answerText)) >= 0 || norm(result.answerText).indexOf(norm(liveBefore)) >= 0)
        : (!!aiKeys && aiKeys.split('').sort().join('') === String(liveBefore).split('').sort().join(''));
      if (same || !fixWrong) {
        st.skipped++;
        CXAI.Log.info(`#${no} 已答（页面：${liveBefore || '-'}），跳过`);
        recordQ(q, result, { ok: true }, 'skip');
        CXAI.UI.update({ done: appliedCount() + st.skipped, total: st.total });
        saveSession(true);
        return { q, skipped: true };
      }
      CXAI.Log.warn(`#${no} 页面答案是 ${liveBefore}，与判定 ${result ? result.answerText : '(待判)'} 不一致，重做这题`);
    }

    if (!result) {
      CXAI.Log.info(`#${no} 判定中 · ${q.typeLabel} · ${CXAI.U.truncate(q.stem, 40)}`);
      result = await CXAI.AI.solve(q);
      st.cache.set(ck, result);
      saveAnswer(q, result);
    }

    await waitIfPaused();
    // 重试：每次重试都重新取元素引用（页面重绘是最常见的失败原因）
    const retries = Math.max(0, Number(CXAI.Cfg.get('apply.retries', 2)) || 0);
    let applied = { ok: false, error: '未执行' };
    for (let attempt = 0; attempt <= retries; attempt++) {
      if (attempt) {
        CXAI.Log.warn(`#${no} 页面元素可能已重绘，重新取一次再落盘（第 ${attempt}/${retries} 次）`);
        await sleep(CXAI.U.randInt(350, 700));
      }
      applied = await CXAI.Apply.apply(attempt === 0 ? q : relive(q), result);
      if (applied.ok) break;
    }
    const live = (CXAI.Scraper.pageValue(q) || {}).value || applied.actual || '';
    if (!applied.ok) {
      st.failed++;
      CXAI.Log.error(`#${no} 写入失败：${applied.error || '未知'}（答案 ${result.answerText}｜页面 ${live || '空'}）`);
      if (applied.dom) CXAI.Log.warn(`选项结构：${applied.dom}`);
      if (CXAI.Cfg.get('apply.stopOnFail', true)) {
        st.haltReason = '写入失败';
        st.paused = true;
        CXAI.Log.warn('已暂停：这题没写进去，继续翻页会漏题。手动选好后在面板点「继续」');
      }
    } else {
      CXAI.Log.ok(
        `#${no} 已填 ${CXAI.U.escapeHtml(result.answerText)} · 页面 ${live || '?'} · ${Math.round((result.confidence || 0) * 100)}% · ${result.stage}`
      );
    }

    // 落盘策略：整卷预览 / 章节测验里每道填空·简答都有自己的「保存」按钮，
    // 不点的话内容会在失焦或页面重绘时被清掉，超星还会拦住"继续填下一题"。
    // 所以这类题在整卷场景下一律自动点保存；其余情况仍按 apply.saveEach 走。
    const wholePage = (function () {
      try {
        return document.querySelectorAll('.questionLi, .TiMu').length > 1;
      } catch (e) {
        return false;
      }
    })();
    // 判断依据放宽到"有没有输入框"：填空/简答靠 input/textarea/iframe 承载答案，
    // 而题型映射在不同皮肤上不一定可靠（有的页面 type 值不同）。整卷里有输入框就落一次盘。
    const hasInput = !!(q.inputs && q.inputs.some(function (el) {
      return el && el.isConnected;
    }));
    const blankLike =
      hasInput || q.type === 'completion' || /填空|简答|论述|名词解释|计算题/.test(String(q.typeLabel || ''));
    if (CXAI.Cfg.get('apply.saveEach', false) || (wholePage && blankLike)) {
      const saved = await CXAI.Apply.saveOne(q);
      if (wholePage && blankLike && !saved) {
        CXAI.Log.warn(`#${no} 是${q.typeLabel || '填空'}题，但没找到该题的「保存」按钮，内容可能会丢`);
      }
    }

    CXAI.UI.addQuestionCard(q, result, applied);
    const rec = { index: q.index, no, qid: q.qid, type: q.type, stem: CXAI.U.truncate(q.stem, 80), result, applied };
    st.results.push(rec);
    // 面板上的"已处理"只算真正落盘的（applied.ok），失败的单独进 failed，
    // 避免失败题被算进作答数，也避免"作答 0 个"这种看不出到底走了几步的统计。
    recordQ(q, result, applied, applied && applied.ok ? 'ok' : 'fail');
    CXAI.UI.update({ done: appliedCount() + st.skipped, total: st.total });
    // 单题模式翻页是整页导航，finally 来不及执行；进度必须在这一题刚落盘时写盘，
    // 否则下一页读回来的 done 永远是 0 —— 用户看到的就是"作答 0 个"。
    saveSession(true);
    return rec;
  }

  /* ---------------- 整卷模式 ---------------- */

  async function runWholePage(page) {
    let { questions } = CXAI.Scraper.collect();
    CXAI.Log.info(`整卷模式：共 ${questions.length} 题`);
    CXAI.UI.update({ total: questions.length, done: 0 });
    if (!questions.length) {
      CXAI.Log.warn('页面上没有找到题目，确认是否在考试/作业页面');
      return;
    }

    for (let i = st.cursor; i < questions.length; i++) {
      st.cursor = i;
      await waitIfPaused();
      // DOM 可能被页面重绘，逐题重新取一次引用
      const fresh = CXAI.Scraper.collect().questions;
      const q = fresh[i] || questions[i];
      if (!q) continue;
      try {
        await handleQuestion(q, page.kind);
      } catch (e) {
        if (e.message === '__STOPPED__') throw e;
        st.failed++;
        CXAI.Log.error(`#${i + 1} 处理异常：${e.message}`);
      }
      if (i < questions.length - 1) await sleep(CXAI.Guard.pace(i));
    }
    CXAI.Log.ok(`整卷处理完毕：成功 ${appliedCount()} · 跳过 ${st.skipped} · 失败 ${st.failed}`);
    await maybeSubmit();
  }

  // 真正落盘的题数（applied.ok）。st.results.length 含失败项，不能当"已作答"用。
  function appliedCount() {
    return st.baseDone + st.results.filter((r) => r.applied && r.applied.ok).length;
  }

  /* ---------------- 无刷新翻页 ----------------
   * 超星单题模式的翻页链是：
   *   getTheNextQuestion(1) → submitForm(true,false,cb)（ajax 保存，回调给 lastUpdateTime|remainTime|enc）
   *                          → window.location.href = 下一页（整页重载）
   * 整页重载会把脚本内存、面板、计时器一起清掉，用户看到的就是"刷新来刷新去"。
   * 这里把后半段换成 fetch + 原地换 DOM：保存还是走页面自己的 submitForm（服务器视角完全一样），
   * 只是不再整页重载。任何一步失败都自动回退到页面原生的「下一题」。
   */

  /** 调页面自己的 submitForm 走 ajax 保存，返回 'lastUpdateTime|remainTime|enc' */
  function pageSubmitSave() {
    return new Promise((resolve) => {
      const w = typeof unsafeWindow !== 'undefined' && unsafeWindow ? unsafeWindow : window;
      if (!w || typeof w.submitForm !== 'function') return resolve(null);
      let done = false;
      const wait = Math.max(2000, Number(CXAI.Cfg.get('engine.softNextTimeoutMs', 6000)) || 6000);
      const timer = setTimeout(() => {
        if (done) return;
        done = true;
        resolve(null);
      }, wait);
      try {
        w.submitForm(true, false, function (data) {
          if (done) return;
          done = true;
          clearTimeout(timer);
          resolve(String(data == null ? '' : data));
        });
      } catch (e) {
        if (!done) {
          done = true;
          clearTimeout(timer);
          resolve(null);
        }
      }
    });
  }

  /** 按页面自己的规则拼下一页地址：start+1，并带上保存回调给的 enc/remainTime */
  function nextUrl(data) {
    const url = new URL(location.href);
    const cur = Number(url.searchParams.get('start') || 0);
    url.searchParams.set('start', String(cur + 1));
    const parts = String(data || '').split('|');
    if (parts.length >= 3 && parts[0] && parts[1] && parts[2]) {
      url.searchParams.set('relationAnswerLastUpdateTime', parts[0]);
      url.searchParams.set('remainTimeParam', parts[1]);
      url.searchParams.set('enc', parts[2]);
    }
    return url.toString();
  }

  /**
   * @returns {Promise<{ok:boolean, why?:string, url?:string, fatal?:boolean}>}
   *   ok    原地换题成功（调用方直接继续循环）
   *   url   保存成功但必须真跳转（富文本页编辑器重建不了 / 已经到最后一题）
   */
  async function softNext() {
    if (!CXAI.Cfg.get('engine.softNext', true)) return { ok: false, why: '已关闭' };
    const page = CXAI.Scraper.detectPage();
    if (page.readonly) return { ok: false, why: '浏览/预览页不记录作答' };
    if (!document.querySelector('#submitTest')) return { ok: false, why: '页面上没有作答表单' };
    if (typeof DOMParser !== 'function') return { ok: false, why: 'DOMParser 不可用' };

    const data = await pageSubmitSave();
    if (!data) return { ok: false, why: 'submitForm 保存回调超时' };
    const url = nextUrl(data);
    let html = '';
    try {
      const res = await fetch(url, { credentials: 'include' });
      if (!res.ok) return { ok: false, why: '取下一页 HTTP ' + res.status };
      html = await res.text();
    } catch (e) {
      return { ok: false, why: '取下一页失败：' + e.message };
    }
    const swapped = CXAI.Scraper.applyNextPage(html);
    if (!swapped.ok) {
      // 到底了：不跳转，交给主循环收尾（跳过去是"无效参数！"死页面）
      if (swapped.end) return { ok: false, end: true, why: swapped.why || '已到最后一题' };
      return { ok: false, why: swapped.why || '换题失败', url };
    }
    // 填空/简答：换完题块必须把 UEditor 重新挂起来（body 异步就绪，要等）
    const editorsOk = CXAI.Scraper.ensureEditorsAsync ? await CXAI.Scraper.ensureEditorsAsync(3000) : true;
    if (!editorsOk) return { ok: false, why: '富文本编辑器没能重建', url };
    try {
      history.replaceState(null, '', url);
    } catch (e) {}
    return { ok: true, url };
  }

  /* ---------------- 单题模式 ---------------- */

  async function runSingleMode(page) {
    const maxIter = CXAI.Cfg.get('engine.maxIterations', 200);
    st.total = CXAI.Scraper.totalCount() || st.total;
    const first = CXAI.Scraper.collect().questions[0];
    CXAI.Log.info(
      '单题模式：逐题作答并翻页（页面题目块 ' + CXAI.Scraper.collect().questions.length +
        ' 个 · 本卷共 ' + (st.total || '?') + ' 题 · 无刷新翻页 ' + (CXAI.Cfg.get('engine.softNext', true) ? '开' : '关') + '）'
    );
    if (first && !first.answered) {
      CXAI.UI.update({ current: CXAI.Scraper.currentIndex() || 1, pending: { index: CXAI.Scraper.currentIndex() || 1, stem: first.stem, typeLabel: first.typeLabel } });
    }
    for (let iter = 0; iter < maxIter; iter++) {
      await waitIfPaused();
      const { questions } = CXAI.Scraper.collect();
      const q = questions[0];
      if (!q) {
        CXAI.Log.warn('当前页未识别到题目，可能已到最后一题');
        break;
      }
      // 题号以页面 start 参数为准（单题模式下一题一块，不能拿数组下标当题号）
      q.no = CXAI.Scraper.currentIndex() || (st.baseDone + iter + 1);
      st.cursor = q.no;
      // 同一道题反复出现 = 翻页在来回弹（典型原因：抓到了"上一题"按钮）
      const vkey = q.qid || CXAI.U.normText(q.stem).slice(0, 60) || '#' + iter;
      st.visited = st.visited || {};
      st.visited[vkey] = (Number(st.visited[vkey]) || 0) + 1;
      if (st.visited[vkey] > 3) {
        CXAI.Log.error(
          '同一道题已被处理 ' + st.visited[vkey] + ' 次（题号附近来回跳），已停止，避免整卷空转。'
        );
        break;
      }
      q.index = iter;
      CXAI.UI.update({ total: st.total || st.baseDone + iter + 1, done: appliedCount() + st.skipped, current: q.no });
      try {
        await handleQuestion(q, page.kind);
      } catch (e) {
        if (e.message === '__STOPPED__') throw e;
        CXAI.Log.error(`第 ${q.no} 题异常：${e.message}`);
      }
      await sleep(CXAI.Guard.pace(iter));
      // 翻页前留落库窗口：超星在换题时会重建题目区，抢在它保存之前换题就丢答案。
      await CXAI.Apply.settle(q);

      // ① 无刷新翻页
      const sn = await softNext();
      if (sn.ok) {
        let movedOk = false;
        for (let w = 0; w < 12; w++) {
          const cur = CXAI.Scraper.collect().questions[0];
          if (cur && (CXAI.U.normText(cur.stem) !== CXAI.U.normText(q.stem) || (cur.qid && q.qid && cur.qid !== q.qid))) {
            movedOk = true;
            break;
          }
          await sleep(120);
        }
        if (movedOk) continue;
        CXAI.Log.warn('无刷新翻页后题目没变，回退原生「下一题」');
      } else if (sn.end) {
        CXAI.Log.ok('已到最后一道题：' + (sn.why || ''));
        break;
      } else if (sn.url) {
        // 富文本页编辑器实在重建不了：让页面自己跳一次并初始化（只跳这一次）
        CXAI.Log.info('改为页面内跳转：' + (sn.why || ''));
        location.href = sn.url;
        return;
      } else if (sn.why && sn.why !== '已关闭') {
        CXAI.Log.info('无刷新翻页不可用（' + sn.why + '），改用原生「下一题」');
      }

      // ② 原生翻页（回退路径）：翻页前自检，页面没把这题记为已答就停下，别静默翻完整卷
      if (!page.readonly) {
        const cur = CXAI.Scraper.collect().questions[0];
        const same = cur && CXAI.U.normText(cur.stem) === CXAI.U.normText(q.stem);
        if (same && !cur.answered) {
          st.failed++;
          CXAI.Log.error(
            `第 ${q.no} 题翻页前自检失败：页面仍是未答状态。已停止翻页，避免整卷记 0 题。`
          );
          CXAI.UI.update({ failed: st.failed });
          break;
        }
      }
      const moved = CXAI.Scraper.clickNext();
      if (!moved) {
        CXAI.Log.ok('没有"下一题"按钮，单题模式结束');
        break;
      }
      await sleep(CXAI.U.randInt(900, 1800));
      let waitCount = 0;
      while (waitCount++ < 12) {
        const cur = CXAI.Scraper.collect().questions[0];
        if (cur && CXAI.U.normText(cur.stem) !== CXAI.U.normText(q.stem)) break;
        await sleep(250);
      }
      const advanced = CXAI.Scraper.collect().questions[0];
      if (advanced && CXAI.U.normText(advanced.stem) === CXAI.U.normText(q.stem)) {
        CXAI.Log.warn('点了"下一题"但题目没变，可能已经是最后一题（或翻页按钮被遮住），停止单题循环');
        break;
      }
    }
    CXAI.Log.ok(`单题模式结束：成功 ${appliedCount()} · 跳过 ${st.skipped} · 失败 ${st.failed}`);
    await maybeSubmit();
  }

  /* ---------------- 点一下 = 答一题 ---------------- */

  /**
   * 答"下一道还没答的题"（点小球一次 = 走一步）。
   *   · 整卷/预览页：直接答当前页里第一道没答案的，答完停在那儿等你再点
   *   · 单题页：答当前这道，然后翻到下一题（不自动连答）
   * 有预取缓存就直接落盘，没有就现场判一次。
   */
  async function answerNext(opt) {
    opt = opt || {};
    if (st.running) {
      CXAI.Log.warn('自动连答正在跑，先「停止」再用单题作答');
      return { ok: false, reason: 'running' };
    }
    const page = CXAI.Scraper.detectPage();
    const { questions } = CXAI.Scraper.collect();
    if (!questions.length) {
      CXAI.Log.warn('这一页没有识别到题目');
      return { ok: false, reason: 'no-question' };
    }
    const whole = questions.length > 1;
    const overwrite = CXAI.Cfg.get('apply.overwriteAnswered', false);
    const isEmpty = (q) => !((CXAI.Scraper.pageValue(q) || {}).value || '');
    const next = overwrite ? questions[0] : questions.filter(isEmpty)[0];
    if (!next) {
      CXAI.Log.ok('这一页的题都已经有答案了');
      CXAI.UI.update({ doneAll: true });
      return { ok: true, reason: 'all-answered', left: 0 };
    }
    const q = next;
    q.no = whole ? questions.indexOf(q) + 1 : (CXAI.Scraper.currentIndex() || 1);
    CXAI.UI.update({ current: q.no });

    let result = stemResult(q) || cachedAnswer(q) || (st.cache.has(cacheKey(q)) ? st.cache.get(cacheKey(q)) : null);
    if (result) {
      CXAI.Log.info(`#${q.no} 用已缓存的判定 ${result.answerText}`);
    } else {
      CXAI.Log.info(`#${q.no} 现场判定 · ${q.typeLabel} · ${CXAI.U.truncate(q.stem || '', 30)}`);
      result = await CXAI.AI.solve(q);
      saveAnswer(q, result);
      st.cache.set(cacheKey(q), result);
    }

    const applied = await CXAI.Apply.apply(q, result);
    const live = (CXAI.Scraper.pageValue(q) || {}).value || applied.actual || '';
    recordQ(q, result, applied, applied && applied.ok ? 'ok' : 'fail');
    CXAI.UI.update({ doneAll: false });
    if (applied && applied.ok) {
      CXAI.Log.ok(`#${q.no} 已填 ${CXAI.U.escapeHtml(result.answerText)} · 页面 ${live || '?'}`);
    } else {
      CXAI.Log.error(`#${q.no} 写入失败：${applied && applied.error}`);
    }
    // 整卷/预览：把这题滚到视野里，方便你看着它落盘
    if (whole && q.root && q.root.scrollIntoView) {
      try {
        q.root.scrollIntoView({ block: 'center', behavior: 'smooth' });
      } catch (e) {}
    }
    // 单题页：答完翻到下一题，下一次点击继续
    if (!whole && opt.advance !== false && page.mode === 'single') {
      await CXAI.Apply.settle(q);
      const sn = await softNext();
      if (sn.ok) {
        // 已原地换到下一题，停在那儿等下一次点击
      } else if (sn.url) {
        // 富文本页等必须由页面自己初始化的场景：整页跳过去
        location.href = sn.url;
        return { ok: !!(applied && applied.ok), q: q.no, advance: 'reload' };
      } else if (!sn.end) {
        CXAI.Scraper.clickNext();
      }
    }
    const left = CXAI.Scraper.collect().questions.filter(isEmpty).length;
    if (!left) CXAI.UI.update({ doneAll: true, running: false });
    return { ok: !!(applied && applied.ok), q: q.no, left };
  }

  /* ---------------- 预取答案（后台跑，不碰页面） ---------------- */

  /**
   * 把当前页每道"还没答案"的题先判一遍，结果按 qid 存起来。
   * 只写存储，不动 DOM —— 之后点一下球就是"读缓存 + 落盘"，秒出。
   */
  async function prefetch(opt) {
    opt = opt || {};
    if (st.prefetching) return st.prefetchPromise || 0;
    st.prefetching = true;
    const concurrency = Math.max(1, Math.min(4, Number(CXAI.Cfg.get('engine.prefetchConcurrency', 2)) || 2));
    const overwrite = CXAI.Cfg.get('apply.overwriteAnswered', false);
    let queue = [];
    try {
      queue = (CXAI.Scraper.collect().questions || []).filter((q) => {
        if (stemResult(q) || cachedAnswer(q) || st.cache.has(cacheKey(q))) return false;
        if (!overwrite && (CXAI.Scraper.pageValue(q) || {}).value) return false;
        return true;
      });
    } catch (e) {
      queue = [];
    }
    if (!queue.length) {
      st.prefetching = false;
      return 0;
    }
    CXAI.Log.info(`开始预取 ${queue.length} 道题的答案（并发 ${concurrency}），期间你可以随时点小球答一题`);
    let done = 0;
    let stopped = false;
    const worker = async () => {
      while (queue.length && !stopped && !st.stopped) {
        const q = queue.shift();
        try {
          const r = await CXAI.AI.solve(q);
          saveAnswer(q, r);
          st.cache.set(cacheKey(q), r);
          done++;
          CXAI.Log.ok(`预取 ${done}/${done + queue.length} · #${(Number(q.index) || 0) + 1} ${CXAI.U.truncate(q.stem || '', 24)} → ${r.answerText}`);
          CXAI.UI.update({ prefetched: done });
        } catch (e) {
          CXAI.Log.warn('预取失败：' + e.message);
        }
      }
    };
    st.prefetchPromise = Promise.all(Array.from({ length: concurrency }, worker)).then(() => {
      st.prefetching = false;
      CXAI.Log.ok(`预取完成：${done} 道题已缓存，点小球即可逐题落盘`);
      return done;
    });
    return st.prefetchPromise;
  }

  /* ---------------- 用页面现状给清单打底 ---------------- */

  /**
   * 把"页面上已经存在的答案"读进清单：整卷/预览模式下 10 道题可能早就答过了，
   * 面板不能一片"未答"。这些行进 status='skip'（已答·原有），AI 答案留空——
   * 我们并不知道用户当时选了什么，不猜。
   */
  function primeFromPage() {
    try {
      const qs = CXAI.Scraper.collect().questions || [];
      if (!qs.length) return 0;
      const whole = qs.length > 1;
      const base = whole ? 0 : (CXAI.Scraper.currentIndex() || 1) - 1;
      // 已经有 AI 结论的行不要被"打底"覆盖掉（否则刚答完的题会变成"AI 未参与"）
      const existing = {};
      try {
        (CXAI.UI.getQList() || []).forEach((r) => {
          if (r && r.key) existing[r.key] = r;
        });
      } catch (e) {}
      let n = 0;
      qs.forEach((q, i) => {
        const pv = (CXAI.Scraper.pageValue(q) || {}).value || '';
        if (!pv) return;
        const no = whole ? i + 1 : base + 1;
        const rowKey = q.qid ? 'qid:' + q.qid : 'stem:' + (CXAI.U.normText(q.stem || '').slice(0, 40));
        const prev = existing[rowKey];
        if (prev && prev.answer) return; // 留着 AI 的结论
        CXAI.UI.pushQuestion({
          index: no,
          qid: q.qid || '',
          type: q.type || '',
          typeLabel: q.typeLabel || '',
          stem: CXAI.U.truncate(q.stem || '', 240),
          options: (q.options || []).slice(0, 10).map((o) => ({ k: o.key, t: CXAI.U.truncate(o.text || '', 60), a: !!o.answered })),
          answer: '',
          actual: pv,
          status: 'skip',
          stage: 'stored',
          key: rowKey
        });
        n++;
      });
      if (n) CXAI.Log.info('页面上已有 ' + n + ' 道题的答案，已填入清单（标为"已答·原有"）');
      return n;
    } catch (e) {
      return 0;
    }
  }

  /* ---------------- 清单点行跳转 ---------------- */

  /**
   * 跳到第 n 题（n = 面板上显示的题号，从 1 起）。
   * 超星页面自己的 getTheQuestionByStart(start) 收的是 URL 里的 start 值，等于题号-1。
   */
  function jumpTo(n) {
    const target = Math.max(0, Number(n) || 0) - 1;
    const cur = CXAI.Scraper.currentIndex();
    if (cur && target === cur - 1) {
      CXAI.Log.info('已经在第 ' + n + ' 题');
      return;
    }
    const w = typeof unsafeWindow !== 'undefined' && unsafeWindow ? unsafeWindow : window;
    try {
      if (typeof w.getTheQuestionByStart === 'function') {
        CXAI.Log.info('跳转到第 ' + n + ' 题');
        w.getTheQuestionByStart(target);
        return;
      }
    } catch (e) {}
    try {
      const url = new URL(location.href);
      url.searchParams.set('start', String(target));
      location.href = url.toString();
    } catch (e) {
      CXAI.Log.warn('跳转失败：' + e.message);
    }
  }

  /* ---------------- 交卷 ---------------- */

  async function maybeSubmit() {
    // v1.8.0：考试页面板与设置中心写的是 apply.submit，旧代码读的是 apply.autoSubmit —— 两个都认，别让开关只生效一半
    if (!CXAI.Cfg.get('apply.autoSubmit', false) && !CXAI.Cfg.get('apply.submit', false)) {
      CXAI.Log.warn('未开启自动交卷。请人工复核标黄题目后再手动交卷。');
      return;
    }
    const btn = CXAI.Apply.findSubmitButton();
    if (!btn) {
      CXAI.Log.warn('未找到交卷按钮，请手动提交');
      return;
    }
    CXAI.Log.warn('10 秒后自动交卷，需要中止请点「停止」');
    await sleep(10000);
    if (st.stopped) return;
    await CXAI.Apply.humanClick(btn, { nativeFallback: true });
    CXAI.Log.ok('已点击交卷');
  }

  /* ---------------- 对外 ---------------- */

  async function start() {
    if (st.running) return;
    const providers = CXAI.Cfg.activeProviders();
    if (!providers.length) {
      CXAI.Log.error('还没有配置模型：点面板右上角 ⇅ 粘同步码拉取，或在设置中心（网页版）配好后生成同步码');
      if (CXAI.UI.openSync) CXAI.UI.openSync();
      return;
    }

    st.running = true;
    st.stopped = false;
    st.paused = false;
    st.cursor = 0;
    // 整页导航会把内存清零，续跑时把上一页的累计进度接回来
    st.baseDone = 0;
    try {
      const prev = CXAI.Store.get(SESSION_KEY, null);
      const winMs = (Number(CXAI.Cfg.get('engine.resumeWindowMin', 20)) || 20) * 60000;
      if (prev && prev.running && Date.now() - (Number(prev.at) || 0) < winMs) {
        st.baseDone = Number(prev.done) || 0;
        st.visited = prev.visited || {};
        st.previewTried = !!prev.previewTried;
        if (st.baseDone > 0) CXAI.Log.info('接着上次进度：已完成 ' + st.baseDone + ' 题');
      }
    } catch (e) {}
    st.results = [];
    st.skipped = 0;
    st.failed = 0;
    st.startedAt = Date.now();
    let _n = 0;
    try {
      st.total = CXAI.Scraper.totalCount() || 0;
      _n = st.total || CXAI.Scraper.collect().questions.length;
    } catch (e) {}
    // 面板清单跨页保留：先把上次的记录摆回面板，"已处理"从清单里的成功条数起算
    let prevList = [];
    try {
      prevList = CXAI.UI.getQList ? CXAI.UI.getQList() : [];
    } catch (e) {}
    st.baseDone = prevList.filter((x) => x && x.status === 'ok').length;
    // 整卷/预览模式下先把"页面上已经答过的题"读进清单，别让面板一片未答
    try {
      primeFromPage();
    } catch (e) {}
    CXAI.UI.update({
      running: true,
      doneAll: false,
      paused: false,
      providers: providers.length,
      done: appliedCount() + st.skipped,
      total: _n,
      qlist: prevList,
      current: CXAI.Scraper.currentIndex() || 1
    });
    saveSession(true);

    try {
      const page = CXAI.Scraper.detectPage();
      CXAI.UI.update({ pageKind: page.kind });
      CXAI.Log.info(`页面识别：${page.kind} · ${page.title || location.pathname}`);
      if (page.kind === 'unknown') {
        CXAI.Log.error('当前页面不是学习通考试/作业页，脚本待机');
        return;
      }
      if (page.readonly) {
        CXAI.Log.warn(
          '⚠ 当前是试卷浏览/预览页（' + location.pathname + '）：这里点选项只有本地高亮，超星不会记录作答。' +
            '要真正落库请进正式考试或作业页面（/exam-ans/exam/test/... 或 /work/dowork）。'
        );
      }
      // 有「整卷预览」入口就先切过去：一页装下全部题目，答题全程不用翻页
      // （ocsjs 也是这么干的）。只在单题模式下尝试，且一程只尝试一次，失败自动回退。
      if (
        page.kind !== 'chapter' &&
        page.mode === 'single' &&
        !st.previewTried &&
        CXAI.Cfg.get('answer.preferPreview', true)
      ) {
        const entry = CXAI.Scraper.previewEntry();
        if (entry) {
          st.previewTried = true;
          saveSession(true);
          CXAI.Log.info('发现「整卷预览」入口：先切到整卷模式（一页装下全部题目，不必逐题翻页）');
          await sleep(CXAI.U.randInt(400, 900));
          const entered = CXAI.Scraper.enterPreview();
          if (entered) {
            st.handoff = true;
            CXAI.Log.info('已点击整卷预览，页面切换后会自动继续答题');
            return;
          }
          CXAI.Log.warn('整卷预览入口点不动，继续用单题模式');
        }
      }
      // 整卷预览页刚切过来时题块可能还没渲染完，先等它出现（最多 12s），别一上来就判"没有题目"
      if (!CXAI.Scraper.collect().questions.length) {
        const deadline = Date.now() + 12000;
        while (Date.now() < deadline) {
          await sleep(400);
          if (CXAI.Scraper.collect().questions.length) break;
        }
      }
      if (page.kind === 'chapter') await runWholePage(page);
      else if (page.mode === 'single') await runSingleMode(page);
      else await runWholePage(page);
      CXAI.UI.update({ doneAll: true });
    } catch (e) {
      if (e.message === '__STOPPED__') CXAI.Log.warn('已手动停止');
      else CXAI.Log.error('运行中断：' + e.message);
    } finally {
      if (st.handoff) {
        // 交接给下一页：**先**在 st.running 还是 true 的时候写盘（saveSession 会与 st.running 取与），
        // 再把内存状态放下。顺序反了就会写成 running:false，新页面永远不会自动开始。
        saveSession(true);
        st.running = false;
        st.handoff = false;
        CXAI.Log.info('已切到整卷预览，等新页面加载后自动接着答');
      } else {
        const cost = Math.round((Date.now() - st.startedAt) / 1000);
        CXAI.Log.info(`总耗时 ${cost}s · 成功 ${appliedCount()} · 跳过 ${st.skipped} · 失败 ${st.failed}`);
        st.running = false;
        st.paused = false;
        saveSession(false);
      }
      CXAI.UI.update({ running: false, paused: false });
    }
  }

  function togglePause() {
    if (!st.running) return;
    st.paused = !st.paused;
    CXAI.Log.warn(st.paused ? '已暂停' : '继续');
    CXAI.UI.update({ paused: st.paused });
  }

  function stop() {
    if (!st.running) return;
    st.stopped = true;
    st.paused = false;
    saveSession(false);
    CXAI.Log.warn('停止中…');
  }

  return { start, togglePause, stop, jumpTo, softNext, primeFromPage, answerNext, prefetch, st, saveSession };
})();

/* ---------------- 启动 ---------------- */

(function boot() {
  /**
   * 读取 URL 里的配置码并落到本域存储。
   * 为什么需要它：油猴存储按域名隔离，设置中心（pages.dev）写的配置考试页（chaoxing.com）读不到，
   * 只能由设置中心生成链接，本脚本在任意匹配页面把配置码导入本域。
   */
  function consumeConfigHash() {
    let raw = '';
    try {
      raw = String(location.hash || '');
    } catch (e) {
      return false;
    }
    const m = /[#&]cxai_cfg=([A-Za-z0-9+/=%_-]+)/.exec(raw);
    if (!m) return false;
    const obj = CXAI.cfgCodec.decode(decodeURIComponent(m[1]));
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
      CXAI.Log.warn('配置码解不出来，忽略');
      return false;
    }
    try {
      CXAI.Cfg.importJSON(obj);
    } catch (e) {
      CXAI.Log.error('配置码导入失败：' + (e && e.message ? e.message : e));
      return false;
    }
    // 清掉 hash：刷新不重复导入，配置也不留在地址栏 / 浏览历史里
    try {
      const clean = location.href.replace(/([#&])cxai_cfg=[^&#]*/g, '').replace(/[#&]+$/, '');
      history.replaceState(null, '', clean);
    } catch (e) {}
    CXAI.Log.ok(
      '已通过链接导入设置中心的配置 · 模型 ' + (CXAI.Cfg.get('ai.providers', []) || []).length + ' 个 · 本域已生效'
    );
    return true;
  }

  function ready() {
    try {
      // 设置中心「同步到学习通」带过来的配置码：先落库，再走正常流程
      try {
        consumeConfigHash();
      } catch (e) {}
      // 独立设置中心（/settings.html）：整页接管，不跑任何考试逻辑、不装环境伪装、不挂浮球
      if (CXAI.Settings && CXAI.Settings.isHere()) {
        try {
          CXAI.Settings.mount();
        } catch (e) {
          console.error('[CX-AI] 设置中心渲染失败', e);
        }
        return;
      }
      // 只在"真正能作答的考试/作业页"出现：课程首页、讨论区、已交卷回看页一律不挂界面，
      // 连环境伪装都不装（那是全局副作用，不该出现在普通页面）。
      const gate = (function () {
        try {
          return CXAI.Scraper.detectPage();
        } catch (e) {
          return null;
        }
      })();
      if (!gate || !gate.answerable) {
        try {
          console.log(
            '[CX-AI] 当前页面不是考试作答页，脚本不出现：' +
              (gate ? gate.kind + (gate.finished ? ' · 已交卷/回看页' : '') : '页面未识别')
          );
        } catch (e) {}
        return;
      }
      CXAI.Cfg.load();
      if (CXAI.Cfg.get('guard.enabled', true)) CXAI.Guard.install();
      CXAI.UI.mount();
      // 交卷/跳到回看页之后，界面自己收掉（用户点交卷、或页面自己跳转都能兜住）
      setInterval(function () {
        try {
          if (!document.getElementById('cx-ai-host')) return;
          const p2 = CXAI.Scraper.detectPage();
          if (p2.finished) {
            CXAI.Log.info('检测到已交卷，界面已自动隐藏');
            CXAI.UI.unmount();
          }
        } catch (e) {}
      }, 2000);
      try {
        // 清单必须第一时间从存储恢复：单题模式每翻一页整页重载，面板不能跟着从 0 开始
        const rows0 = CXAI.UI.getQList ? CXAI.UI.getQList() : [];
        CXAI.UI.update({ qlist: rows0 });
        CXAI.UI.update({
          done: rows0.filter((x) => x && x.status === 'ok').length,
          total: CXAI.Scraper.totalCount(),
          current: CXAI.Scraper.currentIndex()
        });
      } catch (e) {}
      // 超星的题块常常晚于 DOMContentLoaded 才渲染（ajax 回填），
      // v1.4.6 只抓一次，于是面板永远显示"题目 0、已处理 0"。这里轮询补抓。
      (function pollQuestions() {
        const deadline = Date.now() + (Number(CXAI.Cfg.get('engine.bootstrapPollMs', 15000)) || 15000);
        let tries = 0;
        const tick = () => {
          tries++;
          let n = 0;
          let total = 0;
          try {
            n = CXAI.Scraper.collect().questions.length;
            total = CXAI.Scraper.totalCount();
          } catch (e) {}
          if (n > 0) {
            CXAI.UI.update({ total: total || n, current: CXAI.Scraper.currentIndex() });
            try {
              CXAI.Engine.primeFromPage();
            } catch (e) {}
            // 后台预取：先把答案判好缓存下来，之后点小球就是"读缓存 + 落盘"，几乎不用等
            try {
              if (CXAI.Cfg.get('engine.prefetch', true)) {
                setTimeout(function () {
                  try {
                    CXAI.Engine.prefetch();
                  } catch (e) {}
                }, Math.max(500, Number(CXAI.Cfg.get('engine.prefetchDelayMs', 2000)) || 2000));
              }
            } catch (e) {}
            const first = CXAI.Scraper.collect().questions[0];
            if (first) {
              CXAI.UI.update({ pending: { index: CXAI.Scraper.currentIndex() || 1, stem: first.stem, typeLabel: first.typeLabel } });
            }
            return;
          }
          if (Date.now() < deadline) setTimeout(tick, Math.min(1200, 250 + tries * 150));
        };
        setTimeout(tick, 300);
      })();
      CXAI.UI.update({
        providers: CXAI.Cfg.activeProviders().length,
        pageKind: (function () {
          try {
            return CXAI.Scraper.detectPage().kind;
          } catch (e) {
            return '-';
          }
        })()
      });
      CXAI.Log.ok('脚本已加载 · Ctrl+Shift+X 呼出面板');
      // 上次答到一半被页面刷新打断 → 自动接着答
      try {
        const ss = CXAI.Store.get('session', null);
        if (ss && ss.running) {
          const winMs = (Number(CXAI.Cfg.get('engine.resumeWindowMin', 20)) || 20) * 60000;
          const page = CXAI.Scraper.detectPage();
          const fresh = Date.now() - (Number(ss.at) || 0) < winMs;
          if (fresh && page.kind !== 'unknown' && CXAI.Cfg.get('engine.autoResume', true)) {
            CXAI.Log.warn('上次作答被页面刷新打断（已完成 ' + (Number(ss.done) || 0) + ' 题），3 秒后自动接着答');
            setTimeout(function () {
              try {
                CXAI.Engine.start();
              } catch (e) {
                CXAI.Log.error('自动续跑失败：' + e.message);
              }
            }, 3000);
          } else {
            CXAI.Store.remove('session');
          }
        }
      } catch (e) {}
      // 本域第一次跑（或配置没跟着过来）时，直接把设置面板和导入框摆在眼前
      // 本域还没配置：**不自动弹面板**（用户明确要求，除非自己点），
      // 只在悬浮球上点一颗提示点；想配就点球 → 面板里会给出「打开设置中心」与配置码入口。
      var np = (CXAI.Cfg.get('ai.providers', []) || []).length;
      if (!np) {
        CXAI.Log.warn(
          '本域还没有模型配置（存储后端：' + CXAI.Store.backend + '）。' +
            '去设置中心配好后点右上角「生成同步码并上传」，再把同步码粘到面板里 ⇅ 拉取一次（之后自动同步）'
        );
        try {
          CXAI.UI.update({ needSetup: true });
        } catch (e) {}
        // 存过同步码就直接从云端静默拉一次（跨子域唯一可靠的通道）
        try {
          CXAI.Sync.autoPull().then(function (got) {
            if (!got) return;
            CXAI.UI.update({ needSetup: false, providers: CXAI.Cfg.activeProviders().length });
            CXAI.Log.ok('云同步完成 · 直接点「答一题」就行');
          });
        } catch (e) {}
      }
      if (typeof GM_registerMenuCommand === 'function') {
        GM_registerMenuCommand('打开控制台', () => CXAI.UI.togglePanel(true));
        GM_registerMenuCommand('开始答题', () => CXAI.Engine.start());
        GM_registerMenuCommand('输入同步码（云同步）', () => {
          try {
            CXAI.UI.openSync();
          } catch (e) {}
        });
        GM_registerMenuCommand('打开设置中心（配置模型）', () => {
          const url = CXAI.UI && CXAI.UI.settingsURL ? CXAI.UI.settingsURL() : 'https://cx-exam-ai.pages.dev/settings.html';
          try {
            window.open(url, '_blank', 'noopener');
          } catch (e) {
            location.href = url;
          }
        });
      }
    } catch (e) {
      console.error('[CX-AI] 启动失败', e);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(ready, 400));
  } else {
    setTimeout(ready, 400);
  }
})();

/* 暴露给控制台调试 */
try {
  (typeof unsafeWindow !== 'undefined' ? unsafeWindow : window).CXAI = CXAI;
} catch (e) {
  window.CXAI = CXAI;
}