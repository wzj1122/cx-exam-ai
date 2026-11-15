/* ---------------- 页面识别与题目抓取 ----------------
 * 选择器对齐学习通现网结构（考试答题页 / 整卷预览 / 作业页 / 章节测验）。
 */

CXAI.Scraper = (function () {
  /** 学习通题号 -> 题型值映射 */
  const TYPE_MAP = {
    0: 'single',
    1: 'multiple',
    2: 'completion',
    3: 'judgement',
    4: 'completion',
    5: 'completion',
    6: 'completion',
    7: 'completion',
    8: 'completion',
    9: 'completion',
    10: 'completion',
    11: 'line',
    14: 'fill',
    15: 'reader'
  };

  const TYPE_LABEL = {
    single: '单选题',
    multiple: '多选题',
    judgement: '判断题',
    completion: '填空题',
    line: '连线题',
    fill: '完形填空',
    reader: '阅读理解',
    unknown: '未知题型'
  };

  const JUDGE_WORDS = ['正确', '错误', '对', '错', '是', '否', '√', '×', 'true', 'false', 't', 'f', 'yes', 'no'];

  /* ---------- 页面类型 ---------- */

  function detectPage() {
    const href = location.href;
    const hasQuestion = document.querySelectorAll('.questionLi').length > 0;
    const hasTiMu = document.querySelectorAll('.TiMu').length > 0;
    const nextBtn = document.querySelector('[onclick*="getTheNextQuestion"]');

    let kind = 'unknown';
    if (/\/exam\/preview/.test(href)) kind = 'exam-preview';
    else if (/\/exam\/test|\/exam-ans\//.test(href)) kind = 'exam-test';
    else if (/\/work\/dowork/.test(href)) kind = 'work';
    else if (hasTiMu) kind = 'chapter';
    else if (hasQuestion) kind = 'work';

    /**
     * 只读页面：点击有视觉反馈，但页面不会把作答提交给超星。
     *   reVersionTestStartNew-browse  组卷预览 / 试卷浏览
     *   mooc2-ans/exam/lookpaper      查看试卷
     *   /exam-ans/exam/test/look      回看已交试卷
     * 在这些页面上"选了但系统记录 0 题"是页面本身的设计，不是落盘失败，必须提示清楚。
     */
    // 真正的"点了不落库"页面只有几种：教师端试卷浏览 / 回看已交试卷。
    // 学生自己的「整卷预览」(`/exam-ans/mooc2/exam/preview`) 不在此列 —— 真机验证：
    // 它的选项是 `saveSingleSelect(this,qid)`，点一下就走 ajax 保存到 reVersionSubmitTestNew，
    // 而且 answerMode=1（逐题保存），正是"一页答完整卷、不用翻页"的形态。
    const readonly =
      /-browse|lookpaper|preview-browse|\/exam\/test\/look|\/exam-ans\/exam\/test\/look/i.test(href);

    /**
     * 已交卷 / 回看页：`/exam/test/look`、`lookpaper`、成绩单、报告页都算。
     * 这类页面上脚本不该出现（用户明确要求：交卷成功后界面自动消失）。
     */
    let finished =
      /\/exam\/test\/look|lookpaper|reportCard|examResult|exam-analysis|\/exam\/test\/score/i.test(href);
    if (!finished) {
      try {
        const head = String((document.body && document.body.innerText) || '').slice(0, 600);
        finished = /交卷成功|已交卷|考试已结束|提交成功|试卷已提交|成绩单/.test(head);
      } catch (e) {}
    }

    let mode = CXAI.Cfg.get('answer.pageMode', 'auto');
    if (mode === 'auto') {
      if (kind === 'chapter') mode = 'whole';
      else if (nextBtn && document.querySelectorAll('.questionLi').length <= 2) mode = 'single';
      else mode = 'whole';
    }
    // answerable = 真正能作答的考试/作业页。只有它为真才挂界面，
    // 别在课程首页、讨论区、已交卷回看页上挂一堆面板（用户明确要求）。
    const answerable = !finished && !/preview-browse|-browse/i.test(href) && (hasQuestion || hasTiMu);
    return {
      kind,
      mode,
      readonly,
      finished,
      answerable,
      hasQuestion: hasQuestion || hasTiMu,
      nextBtn,
      title: (document.title || '').trim()
    };
  }

  /* ---------- 文本清理 ---------- */

  function cleanStem(text) {
    return String(text || '')
      .replace(/[\t\r]+/g, ' ')
      .replace(/\u00a0/g, ' ')
      .replace(/^\s*\d+\s*[、.．]\s*/, '')
      .replace(
        /^\s*(单项选择题|多项选择题|不定项选择题|判断题|填空题|简答题|论述题|计算题|名词解释题?|案例分析题?|材料分析题?|阅读理解|完形填空|连线题|排序题|其他题)\s*[（(][^）)]*[）)]?\s*/,
        ''
      )
      .replace(/[（(]\s*\d+(?:\.\d+)?\s*分\s*[）)]/g, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }

  function cleanOption(text, idx) {
    let t = String(text || '')
      .replace(/[\t\r\n]+/g, ' ')
      .replace(/\u00a0/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim();
    // 剥离 "A、" "A." "A)" "A：" 这类前缀；仅当剥离后仍有内容
    const m = /^[A-Ha-h]\s*[、.．)）:：]\s*/.exec(t);
    if (m && t.length > m[0].length) return t.slice(m[0].length).trim();
    const m2 = /^[A-Ha-h]\s+/.exec(t);
    if (m2 && t.length > m2[0].length && /[A-Za-z\u4e00-\u9fa5]/.test(t.charAt(m2[0].length))) {
      // 只有后接非字母时才剥，避免把英文单词首字母吃掉
      return t.slice(m2[0].length).trim();
    }
    return t;
  }

  function extractScore(root) {
    const m = (root.textContent || '').match(/[（(]\s*(\d+(?:\.\d+)?)\s*分\s*[）)]/);
    return m ? parseFloat(m[1]) : null;
  }

  /* ---------- 题型判定 ---------- */

  function typeFromValue(v) {
    const n = parseInt(v, 10);
    return TYPE_MAP[n] || 'unknown';
  }

  function guessType(stem, options) {
    const texts = options.map((o) => CXAI.U.normText(o.text));
    if (options.length === 0) return 'completion';
    if (options.length === 2 && texts.every((t) => JUDGE_WORDS.indexOf(t) >= 0)) return 'judgement';
    if (/多选|多项选择|不定项/.test(stem)) return 'multiple';
    if (/判断/.test(stem) && options.length <= 2) return 'judgement';
    if (/填空|简答|论述|名词解释|计算|案例/.test(stem) && options.length === 0) return 'completion';
    return 'single';
  }

  /* ---------- 单题解析 ---------- */

  function readTypeInput(root, pageKind) {
    // 考试页 type 在 input[name^="type"]，作业页在 input[id^="answertype"]
    const candidates = Array.from(root.querySelectorAll('input[name^="type"], input[id^="answertype"], input[answertype]'));
    for (const el of candidates) {
      const name = el.getAttribute('name') || '';
      const id = el.getAttribute('id') || '';
      // 非预览模式会有干扰项，只有 name=type\d+ 才是真题型
      if (/^type\d+$/.test(name)) return typeFromValue(el.value);
      if (/^answertype/.test(id) || el.hasAttribute('answertype')) return typeFromValue(el.value || el.getAttribute('answertype'));
    }
    // 回退：整个页面找一次
    const any = document.querySelector('input[name^="type"], input[answertype]');
    if (any) return typeFromValue(any.value || any.getAttribute('answertype'));
    return null;
  }

  function readStem(root) {
    // 优先 .mark_name（题目标题），其次 h3，再次整块文本
    const selectors = ['.mark_name', 'h3', '.Zy_TItle .clearfix', '.Cy_TItle'];
    for (const sel of selectors) {
      const el = root.querySelector(sel);
      if (el && (el.textContent || '').trim()) return el.textContent;
    }
    // 整卷预览：h3 + div 分片
    const parts = Array.from(root.children)
      .filter((c) => !c.classList.contains('stem_answer') && !c.classList.contains('mark_answer'))
      .map((c) => c.textContent || '')
      .join(' ');
    if (parts.trim()) return parts;
    return root.textContent || '';
  }

  function readOptionElements(root) {
    // 选择/判断选项；填空的输入区也在同一批选择器里
    let els = Array.from(root.querySelectorAll('.answerBg .answer_p, .textDIV, .eidtDiv'));
    if (els.length === 0) els = Array.from(root.querySelectorAll('.answerBg, .textDIV, .eidtDiv, .Cy_ulTop li'));
    els = els.filter((el) => {
      if (!el) return false;
      if (el.closest('.mark_answer')) return false; // 答案解析区
      // 富文本编辑器（填空/简答）的容器也叫 .textDIV，里面是工具栏 + iframe。
      // 不排除的话它会被当成一个"选项"，读数变成 "A:段落格式 字体 字号" 这种垃圾。
      if (el.closest('.subEditor, .edui-editor, .edui-default')) return false;
      if (el.querySelector && el.querySelector('textarea[id], iframe[id^="ueditor"]')) return false;
      if (/subEditor|edui/.test(String(el.className || ''))) return false;
      return true;
    });
    // 关键去重：`.answerBg .answer_p` 与它内部的 `.textDIV` 会同时命中，
    // 不去重的话一道 4 选项的单选会读成 8 个选项，答案字母全错位。
    els = els.filter((el) => !els.some((other) => other !== el && other.contains && other.contains(el)));
    return els;
  }

  /** 选中态类名：check_answer / check_answer_dx / checkAnswer / checked / selected …（排除 un* 反向前缀） */
  const SEL_TOKEN = /^(check_?answer\w*|checked|selected|active|chosed|chosen|curSelected)$/i;

  function markHit(node) {
    if (!node) return false;
    if (node.getAttribute && node.getAttribute('aria-checked') === 'true') return true;
    if (node.hasAttribute && node.hasAttribute('checked')) return true;
    const tokens = String(node.className || '').split(/\s+/);
    return tokens.some((t) => !!t && !/^un/i.test(t) && SEL_TOKEN.test(t));
  }

  /**
   * 选项的"作用域"：从选项往上走，直到再上一层就会把别的选项也包进来为止。
   *
   * 这一步是必须的。超星考试页的结构是
   *   .stem_answer
   *     > .answerBg(选项A) > .answer_p
   *     > .answerBg(选项B) > .answer_p
   * v1.4.6 把判定往上找到 .stem_answer 的 `[class*="check_answer"]`，
   * 而 .stem_answer 同时包住 A/B/C/D —— 只要选中任意一个，四个选项就全被当成"已选"，
   * 于是多选的"取消多余勾选"一次都不执行（真机留下 answers{qid}=ACD 而正确答案是 AB），
   * 判断题/单选也会被误判为已答而跳过。
   */
  const OPTISH = '.answer_p, .textDIV, .eidtDiv, .answerBg, .Cy_ulTop li, .stem_answer > *';

  function optionScope(el, siblings) {
    if (!el) return null;
    const sibs = (siblings || []).filter(Boolean);
    let scope = el;
    let cur = el.parentElement;
    let guard = 0;
    while (cur && guard++ < 8) {
      if (sibs.length) {
        if (sibs.some((o) => o !== el && o !== scope && cur.contains(o))) break;
      } else {
        // 没给兄弟列表时（外部直接调 isChecked），用"这层包着几个可选项"判断越界：
        // 包了 2 个以上就说明再往上已经不是单个选项的容器了。
        let count = 0;
        try {
          count = cur.querySelectorAll(OPTISH).length;
        } catch (e) {
          count = 0;
        }
        if (count > 1) break;
      }
      scope = cur;
      cur = cur.parentElement;
    }
    return scope;
  }

  function isOptionAnswered(el, type, siblings) {
    if (type === 'completion') {
      const ta = el.querySelector('textarea');
      if (ta && ta.value && ta.value.trim()) return true;
      const frame = el.querySelector('iframe');
      if (frame) {
        try {
          const body = frame.contentDocument && frame.contentDocument.body;
          if (body && (body.innerText || '').trim()) return true;
        } catch (e) {}
      }
      const inp = el.querySelector('input[type="text"]');
      if (inp && inp.value && inp.value.trim()) return true;
      return false;
    }
    // 只在"仅含这一个选项"的容器里找选中标记
    const scope = optionScope(el, siblings) || el;
    if (markHit(scope)) return true;
    try {
      const inner = scope.querySelectorAll ? Array.from(scope.querySelectorAll('*')).slice(0, 30) : [];
      if (inner.some(markHit)) return true;
    } catch (e) {}
    const inp =
      (scope.querySelector && scope.querySelector('input[type="radio"], input[type="checkbox"]')) ||
      (el.querySelector && el.querySelector('input[type="radio"], input[type="checkbox"]'));
    if (inp && (inp.checked || (inp.hasAttribute && inp.hasAttribute('checked')))) return true;
    return false;
  }

  function readTextInputs(root) {
    const list = [];
    root.querySelectorAll('textarea, input[type="text"]').forEach((el) => {
      if (el.closest('.mark_answer')) return;
      list.push(el);
    });
    root.querySelectorAll('iframe').forEach((el) => {
      if (el.closest('.mark_answer')) return;
      list.push(el);
    });
    return list;
  }

  function readImages(root) {
    const urls = [];
    root.querySelectorAll('img').forEach((img) => {
      const src = img.getAttribute('src') || img.getAttribute('data-src') || '';
      if (!src) return;
      if (/\/static\/|icon|logo|blank\.gif/i.test(src)) return;
      urls.push(new URL(src, location.href).href);
    });
    return urls;
  }

  function parseOne(root, index, pageKind) {
    const typeFromInput = readTypeInput(root, pageKind);
    const optionEls = readOptionElements(root);
    const stemRaw = readStem(root);
    const stem = cleanStem(stemRaw);

    const options = optionEls.map((el, i) => {
      const raw = (el.innerText || el.textContent || '').trim();
      return {
        key: String.fromCharCode(65 + i),
        text: cleanOption(raw, i),
        raw,
        el,
        answered: false
      };
    });

    let type = typeFromInput;
    if (!type || type === 'unknown') type = guessType(stem, options);
    // 选择题但无法匹配选项 -> 视为填空
    if ((type === 'single' || type === 'multiple' || type === 'judgement') && options.length === 0) {
      type = 'completion';
    }

    const optEls = options.map((o) => o.el);
    options.forEach((o) => {
      o.answered = isOptionAnswered(o.el, type, optEls);
    });

    const q = {
      index,
      key: CXAI.U.normText(stem).slice(0, 120) || 'q' + index,
      qid: qidOf(root),
      type,
      typeLabel: TYPE_LABEL[type] || '未知题型',
      stem,
      stemRaw: String(stemRaw || '').replace(/\s+/g, ' ').trim(),
      options,
      inputs: type === 'completion' ? readTextInputs(root) : [],
      images: readImages(root),
      score: extractScore(root),
      root,
      answered: false
    };
    q.answered = isAnsweredNow(q);
    return q;
  }

  /**
   * 这题在页面上是不是已经答了。
   * 选择题以"页面自己的答案隐藏域"为准（#answer{qid} / answers{qid}），
   * 拿不到再退回看选项选中标记；填空/简答看 UEditor / 文本框里有没有内容。
   */
  function isAnsweredNow(q) {
    if (!q) return false;
    const v = pageValue(q);
    if (v && v.value) return true;
    if (q.type === 'completion') return false;
    return (q.options || []).some((o) => o.answered);
  }

  /* ---------------- 页面真实答案 / 题库无关的确定性线索 ---------------- */

  /** 超星的题号：.questionLi[data] 或表单里的 #questionId */
  function qidOf(root) {
    try {
      const li = root && root.closest ? root.closest('.questionLi') : null;
      const d = (li || root) && (li || root).getAttribute && (li || root).getAttribute('data');
      if (d && /^\d+$/.test(String(d).trim())) return String(d).trim();
    } catch (e) {}
    const inp = document.querySelector('#questionId') || document.querySelector('input[name="questionId"]');
    return inp ? String(inp.value || '').trim() : '';
  }

  /**
   * 判断题在页面隐藏域里存的不是 A/B，而是 `true` / `false`（真机实测 #5 判断题
   * `answer{qid}=true`）。拿它去和 AI 的 `A` 比对必然对不上，于是：
   *   ① 已答对的判断题被判成"答错了"→ 反复重做；
   *   ② 落盘验收用 A 比 true → 永远 ok:false → 自动暂停。
   * 这里统一折算成选项字母：按选项文字找出"正确/错误"分别是哪个 key，找不到再退 A/B。
   */
  function judgeKey(q, raw) {
    const txt = String(raw == null ? '' : raw).trim().toLowerCase();
    if (!txt) return '';
    const opts = (q && q.options) || [];
    const find = (re) => opts.filter((o) => re.test(String(o.text || '').trim().toLowerCase()))[0];
    const yes = find(/^(正确|对|是|√|true|t|yes|1)$/) || find(/正确|^对$/);
    const no = find(/^(错误|错|否|×|false|f|no|0)$/) || find(/错误|^错$/);
    if (/^(true|1|t|对|正确|是|√|yes)$/.test(txt)) return yes ? yes.key : 'A';
    if (/^(false|0|f|错|错误|否|×|no)$/.test(txt)) return no ? no.key : 'B';
    return /^[a-h]+$/i.test(txt) ? txt.toUpperCase() : '';
  }

  /** 把页面上的答案折算成统一的字母串（判断题做 true/false → 选项字母） */
  function normPageAnswer(q, raw) {
    const v = String(raw == null ? '' : raw).trim();
    if (!v) return '';
    if (!q || q.type !== 'judgement') return /^[A-H]+$/i.test(v) ? v.toUpperCase() : v;
    const k = judgeKey(q, v);
    return k || (/^[A-H]+$/i.test(v) ? v.toUpperCase() : v);
  }

  /** HTML → 纯文本（简答的隐藏域里可能存的是 <p>…</p>） */
  function toPlain(t) {
    return String(t == null ? '' : t)
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /** 页面自己记录的作答内容（选择题=选中字母串，填空/简答=文本） */
  function pageValue(q) {
    if (!q) return { value: '', src: '' };
    const qid = q.qid || qidOf(q.root);
    if (qid) {
      const a =
        document.getElementById('answer' + qid) ||
        document.querySelector('[name="answer' + qid + '"]');
      const as = document.querySelector('[name="answers' + qid + '"]');
      const readOne = (el, src) => {
        const raw = String((el && el.value) || '').trim();
        if (!raw) return null;
        const isText = q && (q.type === 'completion' || q.type === 'line');
        return { value: isText ? toPlain(raw) : normPageAnswer(q, raw), raw: raw, src: src };
      };
      const hit = readOne(a, 'answer') || readOne(as, 'answers');
      if (hit) return hit;
    }
    const ed = ueditorOf(q);
    if (ed) {
      const t = plainOf(ed);
      if (t) return { value: t, src: 'ueditor' };
    }
    for (const el of q.inputs || []) {
      if (el && el.value != null && String(el.value).trim()) return { value: toPlain(el.value), src: 'input' };
      if (el && el.tagName === 'IFRAME') {
        try {
          const b = el.contentDocument && el.contentDocument.body;
          if (b && (b.innerText || '').trim()) return { value: String(b.innerText).trim(), src: 'iframe' };
        } catch (e) {}
      }
    }
    // 没有隐藏域时按当前 DOM 的选中标记现算（不能用 q.options[].answered —— 那是解析时的快照，点完就过期了）
    const sibs = (q.options || []).map((o) => o.el);
    const marked = (q.options || [])
      .filter((o) => isOptionAnswered(o.el, q.type, sibs))
      .map((o) => o.key)
      .join('');
    if (marked) return { value: marked, src: 'dom' };
    return { value: '', src: '' };
  }

  /** UEditor 全局对象（页面里叫 UE；Tampermonkey 沙箱下要用 unsafeWindow） */
  function ueditorApi() {
    try {
      if (typeof UE !== 'undefined' && UE && typeof UE.getEditor === 'function') return UE;
    } catch (e) {}
    try {
      const w = typeof unsafeWindow !== 'undefined' && unsafeWindow ? unsafeWindow : null;
      if (w && w.UE && typeof w.UE.getEditor === 'function') return w.UE;
    } catch (e) {}
    return null;
  }

  function plainOf(ed) {
    try {
      if (!ed || !ed.body) return '';
      if (ed.getPlainTxt) {
        const t = String(ed.getPlainTxt() || '').replace(/\u200b/g, '').trim();
        if (t) return t;
      }
      const html = String(ed.getContent ? ed.getContent() : '');
      return html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
    } catch (e) {
      return '';
    }
  }

  /** 找出这道题对应的 UEditor 实例（简答=answer{qid}，填空=answerEditor{qid}N） */
  function ueditorOf(q) {
    const api = ueditorApi();
    if (!api || !q) return null;
    const ids = [];
    const qid = q.qid || qidOf(q.root);
    if (qid) ids.push('answer' + qid);
    const root = q.root || document;
    try {
      Array.from(root.querySelectorAll('textarea[id]')).forEach((el) => {
        if (ids.indexOf(el.id) < 0) ids.push(el.id);
      });
    } catch (e) {}
    (q.inputs || []).forEach((el) => {
      if (el && el.id && ids.indexOf(el.id) < 0) ids.push(el.id);
    });
    for (const id of ids) {
      try {
        const ed = api.getEditor(id);
        if (ed && typeof ed.getContent === 'function' && ed.body) return ed;
      } catch (e) {}
    }
    return null;
  }

  /** 换页后如果新题带富文本编辑器，尽量把实例重新挂上 */
  /** 页面自己初始化填空/简答编辑器时用的参数（从页面内联脚本里抄的，少一项皮肤就可能不一样） */
  const EDITOR_OPTS = {
    initialFrameHeight: 56,
    toolbars: [],
    pasteplain: true,
    disablePasteImage: true,
    disableDraggable: true
  };

  /**
   * 原地换 DOM 之后把富文本编辑器重新挂上。
   *
   * 页面是靠 `UE.getEditor('answerEditor{qid}1', {...})` 初始化的，所以换完题块后
   * 同一个调用能重新建出实例；但 **ed.body 是异步就绪的**（iframe 写文档），
   * 建完立刻读 body 会是 null —— 之前因此把可用的页面误判成"重建失败"，
   * 一遇填空/简答就整个退回真实跳转。这里改成等到 body 就绪为止。
   */
  async function ensureEditorsAsync(timeoutMs) {
    const api = ueditorApi();
    if (!api) return true;
    const areas = Array.from(document.querySelectorAll('textarea[id^="answerEditor"], textarea[id^="answer"]'));
    if (!areas.length) return true;
    const deadline = Date.now() + (Number(timeoutMs) || 3000);
    const sleepLocal = (ms) => new Promise((r) => setTimeout(r, ms));
    for (const ta of areas) {
      let ed = null;
      try {
        ed = api.getEditor(ta.id, EDITOR_OPTS);
      } catch (e) {
        ed = null;
      }
      if (!ed || typeof ed.setContent !== 'function') return false;
      // 判活只能用"实例的 iframe 还在当前文档里"。
      // 不能用 ed.body.ownerDocument === document —— UEditor 的 body 本来就在它自己的
      // iframe 文档里，这么判会把每一个健康编辑器都判死（v1.5.0 首轮真机就栽在这里，
      // 一遇填空/简答就退回真实跳转）。
      const alive = () => !!(ed.body && ed.iframe && document.contains && document.contains(ed.iframe));
      while (Date.now() < deadline && !alive()) await sleepLocal(80);
      if (!alive()) return false;
    }
    return true;
  }

  /**
   * 题干里自带答案时直接采用（本题选AB / 正确答案：AB / 选择：B）。
   * 只认 A-H 的连续字母，且必须落在选项范围内，避免把英文单词首字母当成答案。
   */
  function stemAnswerKeys(stem, options) {
    const s = String(stem || '');
    const max = Math.max(options && options.length ? options.length : 0, 1);
    const pats = [
      /本题\s*(?:请)?(?:选择|选)\s*[:：]?\s*([A-Ha-h]{1,8})/,
      /(?:正确答案|参考答案|标准答案|答案)\s*[:：]\s*([A-Ha-h]{1,8})/,
      /(?:请选择|选择)\s*[:：]\s*([A-Ha-h]{1,8})\s*(?:[。.；;，,]|$)/
    ];
    for (const p of pats) {
      const m = p.exec(s);
      if (!m) continue;
      const letters = String(m[1] || '')
        .toUpperCase()
        .split('')
        .filter((c, i, a) => a.indexOf(c) === i);
      if (!letters.length) continue;
      if (letters.length > max) continue;
      const inRange = letters.every((c) => {
        const idx = c.charCodeAt(0) - 65;
        return idx >= 0 && idx < max;
      });
      if (inRange) return letters;
    }
    return [];
  }

  /**
   * 试卷标识：用来把"作答清单"绑到具体一份卷子上。
   * 用户明确要求：换卷/关掉页面之后旧清单不用留 —— 所以清单按这个 key 存，
   * key 一变就把旧清单丢掉（不做跨卷合并）。
   */
  function paperKey() {
    try {
      const q = new URLSearchParams(location.search);
      const get = (n) => q.get(n) || '';
      let pid = '';
      const el = document.querySelector('#paperId, input[name="paperId"], #testPaperId, input[name="testPaperId"]');
      if (el) pid = String(el.value || '').trim();
      const parts = [pid, get('tId'), get('examId'), get('id'), get('workId'), get('courseId')].filter(Boolean);
      if (parts.length) return parts.join('_');
    } catch (e) {}
    return (location.pathname || '') + '|' + String(document.title || '');
  }

  /**
   * 页面上的「整卷预览」入口。
   * 真机（exam-ans/exam/test/reVersionTestStartNew）上是：
   *   <a class="completeBtn fl" href="javascript:;" onclick="topreview();">整卷预览</a>
   * 走它 = 一页装下全部题目，答题时不用逐题翻页（这也是 ocsjs 的做法）。
   */
  function previewEntry() {
    let nodes = [];
    try {
      nodes = Array.from(document.querySelectorAll('a,div,span,button,li'));
    } catch (e) {
      return null;
    }
    const byFn = nodes.filter((el) => /topreview|preview/i.test(el.getAttribute && (el.getAttribute('onclick') || el.getAttribute('href') || '')));
    const byText = nodes.filter((el) => /^(整卷预览|试卷预览|整卷)$/.test(String((el.textContent || '').trim())));
    const pick = byFn.concat(byText).filter((el) => el && el.offsetParent);
    return pick[0] || null;
  }

  /** 尽可能走页面自己的 topreview()；没有函数就点那个入口 */
  function enterPreview() {
    const w = typeof unsafeWindow !== 'undefined' && unsafeWindow ? unsafeWindow : window;
    try {
      if (typeof w.topreview === 'function') {
        w.topreview();
        return true;
      }
    } catch (e) {}
    const el = previewEntry();
    if (el) {
      try {
        el.click();
        return true;
      } catch (e) {}
    }
    return false;
  }

  /** 整卷题量：优先"题量: N"，其次整卷模式下的题块数 */
  function totalCount() {
    let n = 0;
    try {
      const text = (document.body && document.body.innerText) || '';
      const m = /题量\s*[:：]\s*(\d+)/.exec(text);
      if (m) n = parseInt(m[1], 10);
    } catch (e) {}
    if (!n) {
      const li = document.querySelectorAll('.questionLi').length;
      const timu = document.querySelectorAll('.TiMu').length;
      n = Math.max(li, timu);
    }
    return n || 0;
  }

  /** 当前是第几题（页面 URL 的 start 参数 + 1；整卷模式用题块序号） */
  function currentIndex() {
    try {
      const m = /[?&]start=(\d+)/.exec(location.href);
      if (m) return parseInt(m[1], 10) + 1;
    } catch (e) {}
    return 0;
  }

  /**
   * 无刷新翻页：把 fetch 回来的下一页 HTML 原地换掉当前题块。
   *
   * 注意：`.questionLi` 里就包着 #submitTest（questionId / type{qid} / answers{qid} / enc / start
   * 全在里），整块替换等于连表单状态一起换到新题，页面自己的行内 onclick 也不需要重新绑定
   * （addChoice / addMultipleChoice 都是全局函数 + 行内属性）。
   */
  function applyNextPage(html, opts) {
    opts = opts || {};
    let doc = null;
    try {
      doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
    } catch (e) {
      return { ok: false, why: '解析失败' };
    }
    const newLi = doc.querySelector('.questionLi');
    const oldLi = document.querySelector('.questionLi');
    // 最后一题之后再翻页，超星返回的是"提示 / 无效参数！"页 —— 这里必须报"到底了"，
    // 不能让上层把它当成"编辑���重建失败"而真跳过去（跳过去就回不来了）。
    if (!newLi) return { ok: false, why: '下一页没有题块：已到最后一题', end: true };
    if (!oldLi) return { ok: false, why: '当前页没有题块' };

    // 最后一题之后超星会跳交卷页 / 提示页，这类页面没有 #submitTest，别硬换
    if (!newLi.querySelector('#submitTest') && !doc.querySelector('#submitTest')) {
      return { ok: false, why: '下一页没有作答表单', end: true };
    }

    const formInsideLi = !!(oldLi.querySelector && oldLi.querySelector('#submitTest'));
    oldLi.outerHTML = newLi.outerHTML;

    if (!formInsideLi) {
      const newForm = doc.querySelector('#submitTest');
      const oldForm = document.querySelector('#submitTest');
      if (newForm && oldForm) oldForm.outerHTML = newForm.outerHTML;
    }
    try {
      const w = typeof unsafeWindow !== 'undefined' && unsafeWindow ? unsafeWindow : window;
      if (w && typeof w.answerCardLocateCurrent === 'function') w.answerCardLocateCurrent();
    } catch (e) {}
    try {
      const w = typeof unsafeWindow !== 'undefined' && unsafeWindow ? unsafeWindow : window;
      if (w && w.MathJax && typeof w.MathJax.typeset === 'function') w.MathJax.typeset();
    } catch (e) {}
    return { ok: true };
  }

  /* ---------- 章节测验（.TiMu） ---------- */

  function parseChapter() {
    const nodes = Array.from(document.querySelectorAll('.TiMu'));
    return nodes.map((root, i) => {
      const stemEl = root.querySelector('.Zy_TItle .clearfix, .Zy_TItle, .clearfix');
      const stem = cleanStem(stemEl ? stemEl.textContent : root.textContent);
      const optionEls = Array.from(root.querySelectorAll('.Zy_ulTop li, .answerBg')).filter((el) => !el.closest('.Py_answer'));
      const options = optionEls.map((el, k) => {
        const raw = (el.innerText || el.textContent || '').trim();
        return { key: String.fromCharCode(65 + k), text: cleanOption(raw, k), raw, el, answered: false };
      });
      const typeAttr = root.querySelector('[answertype]');
      let type = typeAttr ? typeFromValue(typeAttr.getAttribute('answertype') || typeAttr.value) : null;
      if (!type || type === 'unknown') type = guessType(stem, options);
      const optEls = options.map((o) => o.el);
      options.forEach((o) => {
        o.answered = isOptionAnswered(o.el, type, optEls);
      });
      const q = {
        index: i,
        key: CXAI.U.normText(stem).slice(0, 120) || 'q' + i,
        qid: qidOf(root),
        type,
        typeLabel: TYPE_LABEL[type] || '未知题型',
        stem,
        stemRaw: stem,
        options,
        inputs: type === 'completion' ? readTextInputs(root) : [],
        images: readImages(root),
        score: null,
        root,
        answered: false
      };
      q.answered = isAnsweredNow(q);
      return q;
    });
  }

  /* ---------- 对外 ---------- */

  function collect() {
    const page = detectPage();
    let questions = [];
    if (page.kind === 'chapter') {
      questions = parseChapter();
    } else {
      const roots = Array.from(document.querySelectorAll('.questionLi')).filter((el) => !el.parentElement.closest('.questionLi'));
      questions = roots.map((root, i) => parseOne(root, i, page.kind));
    }
    // 过滤掉题干完全为空的容器
    questions = questions.filter((q) => q.stem || q.options.length > 0);
    questions.forEach((q, i) => (q.index = i));
    return { page, questions };
  }

  /** 当前是否已经全部答完（用于单题模式判断翻页） */
  function currentAnswered() {
    const { questions } = collect();
    return questions.length > 0 && questions.every((q) => q.answered || (q.options.length > 0 && q.options.some((o) => o.answered)));
  }

  /**
   * 找"下一题"按钮。
   *
   * 超星单题模式里两个按钮是并排的兄弟节点：
   *   上一题  <a class="btnBlue btn_92 fs14" onclick="getTheNextQuestion(-1)">
   *   下一题  <a class="jb_btn jb_btn_92 fs14" onclick="getTheNextQuestion(1)">
   * 早期版本用 [onclick*="getTheNextQuestion"] 取第一个，正好抓中"上一题"，
   * 于是脚本在相邻两题之间来回弹，整卷永远答不完、计数永远是 0。
   */
  function nextButton() {
    const all = Array.from(document.querySelectorAll('[onclick*="getTheNextQuestion"]'));
    const exact = all.find((el) => /getTheNextQuestion\(\s*1\s*\)/.test(el.getAttribute('onclick') || ''));
    if (exact) return exact;
    const loose = all.find((el) => {
      const oc = el.getAttribute('onclick') || '';
      if (/getTheNextQuestion\(\s*-/.test(oc)) return false;
      return !/上一题/.test((el.textContent || '').replace(/\s+/g, ''));
    });
    if (loose) return loose;
    return (
      Array.from(document.querySelectorAll('a,button,div,span')).find(
        (el) => /^下一?题$/.test((el.textContent || '').replace(/\s+/g, '')) && el.offsetParent
      ) || null
    );
  }

  /** 读回页面真正处于选中态的选项 key —— 用来核对 AI 答案有没有真的落到页面上 */
  function selectedKeys(q) {
    if (!q || !q.options || !q.options.length) return '';
    try {
      const sibs = q.options.map((o) => o.el);
      return q.options
        .filter((o) => isOptionAnswered(o.el, q.type, sibs))
        .map((o) => o.key)
        .join('');
    } catch (e) {
      return '';
    }
  }

  function clickNext() {
    const btn = nextButton();
    if (btn) {
      btn.click();
      return true;
    }
    return false;
  }

  /**
   * 在"当前页面重新抓到的题目列表"里找回同一道题。
   * 单题模式页面常有 1~2 个 questionLi（上一题残影 / 下一题预载），
   * 而且重绘后题干里的分值、序号可能变，所以不能只按题干全等匹配。
   */
  function pickSame(list, q) {
    if (!list || !list.length || !q) return null;
    const norm = (t) => CXAI.U.normText(t || '');
    const qStem = norm(q.stem);
    let best = null;
    let bestScore = 0;
    for (const x of list) {
      let score = 0;
      const xs = norm(x.stem);
      if (xs && qStem && xs === qStem) score += 100;
      else if (xs && qStem && xs.length > 8 && qStem.length > 8 &&
        (xs.indexOf(qStem.slice(0, 12)) >= 0 || qStem.indexOf(xs.slice(0, 12)) >= 0)) score += 60;
      // qid 是硬身份：两道纯图片题题干/选项文字可能一模一样，只能靠它区分
      if (q.qid && x.qid) {
        if (x.qid === q.qid) score += 200;
        else score -= 150;
      }
      const qImgs = (q.images || []).join(',');
      const xImgs = (x.images || []).join(',');
      if (qImgs && xImgs) score += qImgs === xImgs ? 60 : -40;
      const qOpts = (q.options || []).map((o) => norm(o.text)).filter(Boolean);
      const xOpts = (x.options || []).map((o) => norm(o.text)).filter(Boolean);
      if (qOpts.length && xOpts.length) {
        const hit = qOpts.filter((t) => xOpts.indexOf(t) >= 0).length;
        score += Math.round((hit / qOpts.length) * 40);
      }
      if (x.index === q.index) score += 5;
      if (score > bestScore) {
        bestScore = score;
        best = x;
      }
    }
    if (best && bestScore >= 40) return best;
    return list.length === 1 ? list[0] : null;
  }

  return {
    detectPage,
    collect,
    parseOne,
    guessType,
    typeFromValue,
    cleanStem,
    cleanOption,
    currentAnswered,
    clickNext,
    nextButton,
    selectedKeys,
    pickSame,
    TYPE_LABEL,
    // v1.5.0
    optionScope,
    isOptionAnswered,
    isAnsweredNow,
    judgeKey,
    normPageAnswer,
    toPlain,
    pageValue,
    stemAnswerKeys,
    totalCount,
    paperKey,
    previewEntry,
    enterPreview,
    currentIndex,
    qidOf,
    ueditorApi,
    ueditorOf,
    ensureEditorsAsync,
    applyNextPage
  };
})();
