/* ---------------- AI 层：模型调用 + 多重判定 ----------------
 * 无题库。每道题都交给模型现场推理，并用"议会 + 交叉复核 + 仲裁"三重机制收敛。
 *
 *   Round 1  并行独立作答    N 个模型/多次采样各自给答案 + 置信度
 *   Round 2  交叉复核        每个模型审阅别人的答案，可改判（权重 1.2 倍）
 *   Round 3  仲裁            分歧时由最高权重模型做最终裁决
 *   收敛规则 加权一致率 >= voteThreshold 直接采纳，否则逐级升级
 */

CXAI.AI = (function () {
  const SYSTEM_SOLVE = [
    '你是一位严谨的中国高校考试答题专家，学科覆盖语文、数学、英语、物理、化学、生物、政治、历史、地理、计算机、医学、法学、管理学、经济学、教育学等全部科目。',
    '',
    '严格遵守以下输出契约：',
    '1. 只输出一个 JSON 对象，不要 markdown 代码块，不要任何解释性前后缀。',
    '2. JSON 结构固定为：{"answer":"<答案>","confidence":<0到1的小数>,"reason":"<不超过60字的核心依据>"}',
    '3. answer 字段的写法：',
    '   - 单选题：单个选项字母，如 "B"',
    '   - 多选题：选项字母连写、按字母升序，如 "ACD"',
    '   - 判断题：单个选项字母（即使选项文本是"正确/错误""对/错""√/×""True/False"，也用字母）',
    '   - 填空题 / 简答题 / 论述题：直接写答案内容；多个空之间用 "|||" 分隔，顺序与题目空位一致',
    '4. confidence 必须真实反映把握程度，不要一律给高分。',
    '5. 题干缺字、选项缺失、图片无法辨识时：仍给出最佳猜测，但 confidence 不得高于 0.4，并在 reason 中注明"信息不全"。',
    '6. 宁可给出一个有依据的判断，也不要输出无法解析的内容。'
  ].join('\n');

  const SYSTEM_CRITIQUE = [
    '你是一位考试答案复核专家。你会看到一道题和若干位答题者给出的答案，任务是指出错误、给出你独立判断的正确答案。',
    '',
    '输出契约：只输出一个 JSON 对象，结构为：',
    '{"answer":"<你最终认为正确的答案>","confidence":<0到1>,"agreeWith":"<你认为正确的候选编号，如 2；都不对填 none>","reason":"<不超过60字为何这样判>"}',
    '不要输出 JSON 以外的内容。'
  ].join('\n');

  const SYSTEM_ARBITER = [
    '你是最终裁决者。多位专家对同一道题给出了不同答案，请综合他们的推理独立判断，给出唯一最终答案。',
    '',
    '输出契约：只输出一个 JSON 对象：',
    '{"answer":"<最终答案>","confidence":<0到1>,"reason":"<不超过80字裁决依据>"}',
    '不要输出 JSON 以外的内容。'
  ].join('\n');

  /* ---------------- 底层请求 ---------------- */

  /** 通用请求：method='GET' 时不带 body */
  function httpMethod(method, url, headers, body, timeoutMs) {
    const hasBody = body != null;
    const payload = hasBody ? JSON.stringify(body) : undefined;
    return new Promise((resolve, reject) => {
      if (typeof GM_xmlhttpRequest === 'function') {
        GM_xmlhttpRequest({
          method: method,
          url,
          headers,
          data: payload,
          timeout: timeoutMs || 90000,
          onload: (res) => {
            let parsed = null;
            try {
              parsed = JSON.parse(res.responseText);
            } catch (e) {}
            if (res.status >= 200 && res.status < 300) resolve(parsed || {});
            else {
              const msg =
                (parsed && parsed.error && (parsed.error.message || parsed.error.code)) ||
                (res.responseText || '').slice(0, 300) ||
                'HTTP ' + res.status;
              reject(new Error('HTTP ' + res.status + ' · ' + msg));
            }
          },
          onerror: () => reject(new Error('网络连接失败（检查 baseURL / 代理）')),
          ontimeout: () => reject(new Error('请求超时'))
        });
        return;
      }
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs || 90000);
      const init = { method: method, headers: headers, signal: ctrl.signal };
      if (hasBody) init.body = payload;
      fetch(url, init)
        .then(async (r) => {
          const text = await r.text();
          let parsed = null;
          try {
            parsed = JSON.parse(text);
          } catch (e) {}
          clearTimeout(timer);
          if (r.ok) resolve(parsed || {});
          else reject(new Error('HTTP ' + r.status + ' · ' + (text || '').slice(0, 300)));
        })
        .catch((e) => {
          clearTimeout(timer);
          reject(e);
        });
    });
  }

  function httpJson(url, headers, body, timeoutMs) {
    return httpMethod('POST', url, headers, body, timeoutMs);
  }

  /* ---------- 三种接口风格的报文构造 ---------- */

  function flatten(content) {
    if (content == null) return '';
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
      return content
        .map((c) => (c && typeof c === 'object' ? (c.type === 'text' ? c.text : c.type === 'image_url' ? '[图片]' : '') : String(c || '')))
        .join('\n');
    }
    return String(content);
  }

  function splitDataUrl(url) {
    const m = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(String(url || ''));
    if (!m) return null;
    return { mime: m[1] || 'image/png', base64: m[3] || '', isBase64: !!m[2] };
  }

  /** 统一的 parts（OpenAI 风格）→ 各家格式 */
  function contentParts(messages) {
    const sys = messages.filter((m) => m.role === 'system').map((m) => flatten(m.content)).join('\n\n');
    const rest = messages.filter((m) => m.role !== 'system');
    return { system: sys, turns: rest };
  }

  function toAnthropic(content) {
    if (typeof content === 'string') return [{ type: 'text', text: content }];
    return (content || []).map((c) => {
      if (!c || typeof c !== 'object') return { type: 'text', text: String(c || '') };
      if (c.type === 'text') return { type: 'text', text: String(c.text || '') };
      if (c.type === 'image_url') {
        const u = (c.image_url && c.image_url.url) || '';
        const d = splitDataUrl(u);
        if (d) return { type: 'image', source: { type: 'base64', media_type: d.mime, data: d.base64 } };
        return { type: 'image', source: { type: 'url', url: u } };
      }
      return { type: 'text', text: '' };
    });
  }

  function toGeminiParts(content) {
    if (typeof content === 'string') return [{ text: content }];
    return (content || []).map((c) => {
      if (!c || typeof c !== 'object') return { text: String(c || '') };
      if (c.type === 'text') return { text: String(c.text || '') };
      if (c.type === 'image_url') {
        const u = (c.image_url && c.image_url.url) || '';
        const d = splitDataUrl(u);
        if (d) return { inline_data: { mime_type: d.mime, data: d.base64 } };
        return { file_data: { file_uri: u } };
      }
      return { text: '' };
    });
  }

  /**
   * 按 provider.apiStyle 生成 {url, headers, body}。
   * 支持：openai（绝大多数中转/本地服务）、anthropic（Messages）、gemini（generateContent）。
   * magpie 网关三种都吃，换风格只改这一个下拉框。
   */
  function buildRequest(provider, messages, opts) {
    opts = opts || {};
    const style = provider.apiStyle === 'anthropic' ? 'anthropic' : provider.apiStyle === 'gemini' ? 'gemini' : 'openai';
    const base = String(provider.baseURL || '').replace(/\/+$/, '');
    const key = String(provider.apiKey || '');
    const temp = opts.temperature != null ? opts.temperature : provider.temperature != null ? provider.temperature : 0.2;
    const maxTokens = Number(opts.maxTokens || provider.maxTokens || 700) || 700;
    const headers = { 'Content-Type': 'application/json' };
    let url = base;
    let body = {};

    if (style === 'anthropic') {
      url = /\/messages$/.test(base) ? base : /\/v\d+$/.test(base) ? base + '/messages' : base + '/v1/messages';
      headers['anthropic-version'] = '2023-06-01';
      if (key) headers['x-api-key'] = key;
      const p = contentParts(messages);
      body = { model: provider.model, max_tokens: maxTokens, temperature: temp, messages: [] };
      if (p.system) body.system = p.system;
      p.turns.forEach((m) => {
        const role = m.role === 'assistant' ? 'assistant' : 'user';
        const content = toAnthropic(m.content);
        const last = body.messages[body.messages.length - 1];
        if (last && last.role === role) last.content = last.content.concat(content);
        else body.messages.push({ role: role, content: content });
      });
      if (!body.messages.length) body.messages.push({ role: 'user', content: [{ type: 'text', text: '' }] });
    } else if (style === 'gemini') {
      const gmodel = String(provider.model || '');
      url = /:generateContent/.test(base)
        ? base
        : base + '/v1beta/models/' + encodeURIComponent(gmodel) + ':generateContent';
      if (key) url += (url.indexOf('?') >= 0 ? '&' : '?') + 'key=' + encodeURIComponent(key);
      const p = contentParts(messages);
      body = {
        contents: p.turns.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: toGeminiParts(m.content) })),
        generationConfig: { temperature: temp, maxOutputTokens: maxTokens }
      };
      if (p.system) body.systemInstruction = { parts: [{ text: p.system }] };
      if (!body.contents.length) body.contents.push({ role: 'user', parts: [{ text: '' }] });
    } else {
      url = /\/chat\/completions$/.test(base) ? base : base + '/chat/completions';
      if (key) headers.Authorization = 'Bearer ' + key;
      body = { model: provider.model, messages: messages, temperature: temp, stream: false };
      body[provider.maxTokensField || 'max_tokens'] = maxTokens;
      if (provider.jsonMode) body.response_format = { type: 'json_object' };
    }

    if (provider.extraHeaders && typeof provider.extraHeaders === 'object') Object.assign(headers, provider.extraHeaders);
    if (provider.extraBody && typeof provider.extraBody === 'object') {
      // 用户可以覆盖任何字段（top_p / reasoning_effort / enable_thinking …）
      Object.keys(provider.extraBody).forEach((k) => {
        const v = provider.extraBody[k];
        if (v && typeof v === 'object' && !Array.isArray(v) && body[k] && typeof body[k] === 'object' && !Array.isArray(body[k])) {
          body[k] = CXAI.U.mergeDeep(body[k], v);
        } else {
          body[k] = v;
        }
      });
    }
    return { url: url, headers: headers, body: body, style: style };
  }

  function extractText(res, style) {
    if (!res) return null;
    if (style === 'anthropic') {
      if (typeof res.content === 'string') return res.content;
      if (Array.isArray(res.content)) {
        const t = res.content
          .filter((c) => c && (c.type === 'text' || c.text))
          .map((c) => String(c.text || ''))
          .join('\n')
          .trim();
        return t || null;
      }
      return null;
    }
    if (style === 'gemini') {
      const cand = res.candidates && res.candidates[0];
      const parts = (cand && cand.content && cand.content.parts) || [];
      const t = parts
        .map((p) => String((p && p.text) || ''))
        .join('')
        .trim();
      return t || null;
    }
    const choice = res.choices && res.choices[0];
    const content = choice && choice.message && choice.message.content;
    if (content == null) return null;
    return typeof content === 'string' ? content : flatten(content);
  }

  /**
   * 拉取该 provider 的可用模型列表（各家 /models 端点）。
   * 返回 [{id, label}]，按 id 排序去重。失败直接抛错，由调用方提示。
   */
  async function listModels(provider) {
    provider = CXAI.normalizeProvider(provider, 0);
    const style = provider.apiStyle === 'anthropic' ? 'anthropic' : provider.apiStyle === 'gemini' ? 'gemini' : 'openai';
    const base = String(provider.baseURL || '').replace(/\/+$/, '');
    const key = String(provider.apiKey || '');
    const headers = { 'Content-Type': 'application/json' };
    let url = base;

    if (style === 'anthropic') {
      url = /\/models$/.test(base) ? base : /\/v\d+$/.test(base) ? base + '/models' : base + '/v1/models';
      headers['anthropic-version'] = '2023-06-01';
      if (key) headers['x-api-key'] = key;
    } else if (style === 'gemini') {
      url = /\/models$/.test(base) ? base : base + '/v1beta/models';
      if (key) url += (url.indexOf('?') >= 0 ? '&' : '?') + 'key=' + encodeURIComponent(key);
    } else {
      url = /\/models$/.test(base) ? base : base.replace(/\/chat\/completions$/, '') + '/models';
      if (key) headers.Authorization = 'Bearer ' + key;
    }
    if (provider.extraHeaders && typeof provider.extraHeaders === 'object') Object.assign(headers, provider.extraHeaders);

    const res = await httpMethod('GET', url, headers, null, Number(provider.timeoutMs) > 0 ? Number(provider.timeoutMs) : 15000);
    const raw = (res && (res.data || res.models || res.result)) || [];
    const arr = Array.isArray(raw) ? raw : [];
    const seen = {};
    const out = [];
    arr.forEach((m) => {
      if (!m) return;
      let id = m.id || m.name || m.model || m.model_name;
      if (!id) return;
      id = String(id).replace(/^models\//, '');
      if (style === 'gemini') {
        const methods = m.supportedGenerationMethods || m.supported_generation_methods;
        if (Array.isArray(methods) && !methods.some((x) => /generateContent/i.test(String(x)))) return;
      }
      if (seen[id]) return;
      seen[id] = 1;
      const dn = m.display_name || m.displayName || '';
      out.push({ id: id, label: dn && dn !== id ? dn + ' · ' + id : id });
    });
    out.sort((a, b) => String(a.id).localeCompare(String(b.id)));
    return out;
  }

  /** 发一次对话请求，返回 {text, usage, model, style} */
  async function callProvider(provider, messages, opts) {
    opts = opts || {};
    provider = CXAI.normalizeProvider(provider, 0);
    const cfg = CXAI.Cfg.get('ai.judge', {});
    const req = buildRequest(provider, messages, opts);
    const timeoutMs = Number(provider.timeoutMs) > 0 ? Number(provider.timeoutMs) : cfg.timeoutMs || 90000;
    const retries = Math.max(0, cfg.retries != null ? cfg.retries : 1);
    let lastErr = null;

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const res = await httpJson(req.url, req.headers, req.body, timeoutMs);
        if (res && res.error && !res.choices && !res.content && !res.candidates) {
          throw new Error((res.error && (res.error.message || res.error.code)) || '端点返回错误');
        }
        const text = extractText(res, req.style);
        if (text == null) {
          if (res && res.choices && res.choices[0] && res.choices[0].message && res.choices[0].message.reasoning_content) {
            throw new Error('模型只返回了 reasoning_content，没有正文（试试关掉推理模式或换模型）');
          }
          throw new Error('响应缺少正文（style=' + req.style + '）');
        }
        return { text: String(text), usage: res.usage || null, model: res.model || provider.model, style: req.style };
      } catch (e) {
        lastErr = e;
        // JSON 模式不被支持时自动降级
        if (req.body.response_format && /response_format|json_object|400/i.test(e.message)) {
          delete req.body.response_format;
          continue;
        }
        if (attempt < retries) await CXAI.U.sleep(600 * (attempt + 1));
      }
    }
    throw lastErr || new Error('调用失败');
  }

  /* ---------------- Prompt 构建 ---------------- */

  function optionBlock(q) {
    if (!q.options || q.options.length === 0) return '';
    return q.options.map((o) => `${o.key}. ${o.text}`).join('\n');
  }

  function buildSolveMessages(q, hint, vctx, provider) {
    const lines = [`【题型】${q.typeLabel}`, `【题干】${q.stem || '(题干为空)'}`];
    if (q.attachMeta) {
      const m = q.attachMeta;
      const note =
        m.mode === 'pages'
          ? '，已逐页转成图片附在下方，请先完整读完附件再作答'
          : m.mode === 'link'
          ? '，附件没能转成图片/文字，只能按文件名与题干线索尽力作答'
          : '，附件通道已关闭，只能按文件名与题干线索尽力作答';
      lines.push(`【附件材料】${m.filename || '附件'}${m.pages ? '（共 ' + m.pages + ' 页）' : ''}${note}。`);
      lines.push(
        '【作答要求】本题的作答框就是整份材料的答题区：请通读附件，把材料里出现的每一道题按顺序作答，' +
          '格式为「1. …」换行「2. …」，不要只回答其中一题，也不要复述题目；' +
          (m.mode === 'pages' ? '' : '缺少材料正文时 confidence 不得高于 0.35。')
      );
    }
    const nImg = q.images ? q.images.length : 0;
    const mode = vctx && vctx.mode;
    if (nImg) {
      if (mode === 'inline' && provider && provider.vision) lines.push(`【图片】本题含 ${nImg} 张图片，已作为图片消息附在下方，请直接读图。`);
      else if (mode === 'ocr') lines.push(`【图片】本题原图已由读图模型转写为文字（见下方【图片转写】），请据此作答。`);
      else lines.push(`【图片】本题含 ${nImg} 张图片，但当前没有可用读图通道，请按已抓到的文字尽力作答，必要时降低置信度。`);
    }
    if (vctx && vctx.vision) {
      const block = CXAI.Vision.composePromptBlock(vctx.vision);
      if (block) lines.push(block);
    }
    const ob = optionBlock(q);
    if (ob) lines.push(`【选项】\n${ob}`);
    else lines.push('【说明】本题为填答题，没有选项，请直接给出要填写的答案。');
    if (hint) lines.push(`【提示】${hint}`);
    lines.push('【输出】只输出 JSON 对象。');
    const userText = lines.join('\n\n');

    const attach = !!(provider && provider.vision && vctx && vctx.mode === 'inline' && vctx.imageParts && vctx.imageParts.length);
    if (attach) {
      return [
        { role: 'system', content: SYSTEM_SOLVE },
        {
          role: 'user',
          content: [{ type: 'text', text: userText }].concat(
            vctx.imageParts.map((i) => ({ type: 'image_url', image_url: { url: i.dataUrl } }))
          )
        }
      ];
    }
    return [
      { role: 'system', content: SYSTEM_SOLVE },
      { role: 'user', content: userText }
    ];
  }

  function visionTail(q, vctx) {
    const lines = [];
    if (vctx && vctx.vision) {
      const block = CXAI.Vision.composePromptBlock(vctx.vision);
      if (block) lines.push(block);
    }
    return lines;
  }

  function buildCritiqueMessages(q, drafts, vctx) {
    const lines = [`【题型】${q.typeLabel}`, `【题干】${q.stem || '(题干为空)'}`];
    const ob = optionBlock(q);
    if (ob) lines.push(`【选项】\n${ob}`);
    visionTail(q, vctx).forEach((l) => lines.push(l));
    const cand = drafts
      .map((d, i) => `${i + 1}. ${d.answerText}（置信度 ${d.confidence.toFixed(2)}）理由：${d.reason || '无'}`)
      .join('\n');
    lines.push(`【候选答案】\n${cand}`);
    lines.push('【输出】只输出 JSON 对象。');
    return [
      { role: 'system', content: SYSTEM_CRITIQUE },
      { role: 'user', content: lines.join('\n\n') }
    ];
  }

  function buildArbiterMessages(q, drafts, critiques, vctx) {
    const lines = [`【题型】${q.typeLabel}`, `【题干】${q.stem || '(题干为空)'}`];
    const ob = optionBlock(q);
    if (ob) lines.push(`【选项】\n${ob}`);
    visionTail(q, vctx).forEach((l) => lines.push(l));
    const cand = drafts
      .map((d, i) => `初答${i + 1}：${d.answerText}（置信度 ${d.confidence.toFixed(2)}）理由：${d.reason || '无'}`)
      .join('\n');
    lines.push(`【初答】\n${cand}`);
    if (critiques && critiques.length) {
      lines.push(
        `【复核意见】\n` +
          critiques
            .map((c, i) => `复核${i + 1}：${c.answerText}（置信度 ${c.confidence.toFixed(2)}，同意候选 ${c.agreeWith || 'none'}）理由：${c.reason || '无'}`)
            .join('\n')
      );
    }
    lines.push('【输出】只输出 JSON 对象。');
    return [
      { role: 'system', content: SYSTEM_ARBITER },
      { role: 'user', content: lines.join('\n\n') }
    ];
  }

  /* ---------------- 答案解析 ---------------- */

  /** 把模型给的原始答案映射为选项 key 数组（选择题）或纯文本（填空题） */
  function resolveAnswerKeys(answer, q) {
    if (answer == null) return null;
    const raw = String(answer).trim();
    if (!raw) return null;

    if (q.type === 'completion' || q.type === 'line' || q.options.length === 0) {
      return { keys: [], text: raw };
    }

    const keys = q.options.map((o) => o.key);
    // 1) 字母直取
    const letters = (raw.toUpperCase().match(/[A-H]/g) || []).filter((l) => keys.indexOf(l) >= 0);
    if (letters.length) {
      const uniq = Array.from(new Set(letters)).sort();
      return { keys: uniq, text: uniq.join('') };
    }

    // 2) 选项文本精确匹配
    const norm = CXAI.U.normText(raw);
    for (const o of q.options) {
      if (CXAI.U.normText(o.text) === norm) return { keys: [o.key], text: o.key };
    }

    // 3) 判断题语义映射
    if (q.type === 'judgement') {
      const truthy = /正确|对|是|√|true|yes/i.test(raw);
      const falsy = /错误|错|否|×|false|no/i.test(raw);
      if (truthy !== falsy) {
        const want = truthy;
        for (const o of q.options) {
          const t = CXAI.U.normText(o.text);
          const isTrue = /^(正确|对|是|√|true|yes|t)$/.test(t);
          const isFalse = /^(错误|错|否|×|false|no|f)$/.test(t);
          if ((want && isTrue) || (!want && isFalse)) return { keys: [o.key], text: o.key };
        }
      }
    }

    // 4) 相似度兜底
    let best = null;
    let bestScore = 0;
    for (const o of q.options) {
      const s = CXAI.U.similarity(raw, o.text);
      if (s > bestScore) {
        bestScore = s;
        best = o.key;
      }
    }
    if (best && bestScore >= 0.34) return { keys: [best], text: best };

    return null;
  }

  /** 解析模型返回的 JSON 为统一结构 */
  function parseModelResult(text, q) {
    const obj = CXAI.U.safeJson(text);
    let answer = obj && (obj.answer != null ? obj.answer : obj.Answer != null ? obj.Answer : obj.result);
    let confidence = obj && Number(obj.confidence != null ? obj.confidence : obj.置信度);
    let reason = obj && (obj.reason || obj.analysis || obj.explain || '');
    let agreeWith = obj && obj.agreeWith;

    if (answer == null) {
      // 纯文本兜底：抠 "答案：A" / 独立字母
      const m = /(?:答案|answer)\s*[:：]?\s*([A-H](?:\s*[,、]?\s*[A-H])*)/i.exec(text);
      if (m) answer = m[1];
      else {
        const only = /^\s*([A-H](?:\s*[,、]?\s*[A-H]){0,7})\s*$/.exec(text);
        if (only) answer = only[1];
      }
    }
    if (answer == null) return null;

    const resolved = resolveAnswerKeys(answer, q);
    if (!resolved) return null;

    if (!isFinite(confidence) || confidence <= 0 || confidence > 1) {
      // 模型给了百分比或缺失
      if (isFinite(confidence) && confidence > 1 && confidence <= 100) confidence = confidence / 100;
      else confidence = 0.6;
    }
    return {
      keys: resolved.keys,
      answerText: resolved.text,
      confidence: CXAI.U.clamp(confidence, 0.01, 1),
      reason: String(reason || '').slice(0, 200),
      agreeWith: agreeWith != null ? String(agreeWith) : null,
      raw: text
    };
  }

  /* ---------------- 投票 ---------------- */

  function tally(drafts) {
    const bucket = new Map();
    let total = 0;
    for (const d of drafts) {
      const k = d.answerText || '∅';
      const w = (d.weight || 1) * (d.confidence || 0.5);
      total += w;
      const cur = bucket.get(k) || { key: k, score: 0, count: 0, supporters: [] };
      cur.score += w;
      cur.count += 1;
      cur.supporters.push(d.providerLabel || d.providerId || '模型');
      bucket.set(k, cur);
    }
    const list = Array.from(bucket.values()).sort((a, b) => b.score - a.score || b.count - a.count);
    const top = list[0];
    return {
      list,
      winner: top,
      ratio: total > 0 && top ? top.score / total : 0
    };
  }

  /* ---------------- 判定主流程 ---------------- */

  function buildPanel() {
    const judgeCfg = CXAI.Cfg.get('ai.judge', {});
    const all = CXAI.Cfg.activeProviders();
    if (all.length === 0) throw new Error('没有启用的模型：请到设置里填写 API Key');

    if (judgeCfg.mode === 'fast') {
      const base = all[0];
      const n = Math.max(2, Math.min(5, judgeCfg.panelSize || 3));
      return Array.from({ length: n }, (_, i) => ({
        ...base,
        providerLabel: base.label + '#' + (i + 1),
        temperature: 0.15 + i * 0.35,
        __sample: i
      }));
    }
    if (judgeCfg.mode === 'single') return [all[0]];

    const size = Math.max(1, Math.min(all.length, judgeCfg.panelSize || 3));
    let list = all.slice(0, size);
    // 勾了「读图模型也参与判题」却因为 panelSize 太小被挤出去时，把最末一票让给它
    if (CXAI.Cfg.get('ai.vision.judgeToo')) {
      const boths = all.filter((p) => p.role === 'both');
      if (boths.length && !list.some((p) => p.role === 'both')) {
        list = list.slice(0, Math.max(0, size - 1)).concat(boths[0]);
      }
    }
    return list.map((p) => ({ ...p, providerLabel: p.label }));
  }

  async function runPool(tasks, concurrency) {
    const results = new Array(tasks.length);
    let cursor = 0;
    const workers = Array.from({ length: Math.min(concurrency, tasks.length) }, async () => {
      while (cursor < tasks.length) {
        const i = cursor++;
        try {
          results[i] = await tasks[i]();
        } catch (e) {
          results[i] = { __error: e };
        }
      }
    });
    await Promise.all(workers);
    return results;
  }

  /* ---------------- 读图通道选择 ---------------- */

  /**
   * 决定这道题的图片怎么处理。
   * @returns {Promise<{mode:'inline'|'ocr'|'none'|'off', imageParts:any[], vision:any|null, dropped:number}>}
   */
  async function resolveVision(question, panel) {
    const vc = CXAI.Vision.cfg();
    const none = { mode: 'none', imageParts: [], vision: null, dropped: 0 };
    if (!vc.enabled || vc.strategy === 'off') return Object.assign({}, none, { mode: 'off' });
    if (!question.images || !question.images.length) return none;

    const prep = await CXAI.Vision.prepare(question);
    if (!prep.items.length) {
      CXAI.Log.warn(`第 ${(question.index || 0) + 1} 题含 ${question.images.length} 张图片，但一张也没读成功，按纯文本判题`);
      return Object.assign({}, none, { dropped: prep.dropped });
    }

    const panelVision = CXAI.Vision.panelHasVision(panel);
    const doOcr = async () => {
      const vp = CXAI.Vision.pickProvider() || (panel.filter((p) => p && p.vision)[0] || null);
      if (!vp) return null;
      try {
        const vis = await CXAI.Vision.transcribe(question, vp, prep.items);
        CXAI.Log.info(
          `第 ${(question.index || 0) + 1} 题读图完成（${vp.label}·${prep.items.length}图）：` +
            CXAI.U.truncate(vis.text || vis.questionText || '(空)', 50)
        );
        return vis;
      } catch (e) {
        CXAI.Log.warn(`第 ${(question.index || 0) + 1} 题读图失败：${e.message}`);
        return null;
      }
    };

    if (vc.strategy === 'inline') return { mode: 'inline', imageParts: prep.items, vision: null, dropped: prep.dropped };
    if (vc.strategy === 'ocr') {
      const vis = await doOcr();
      return { mode: vis ? 'ocr' : 'none', imageParts: [], vision: vis, dropped: prep.dropped };
    }
    // auto：面板里有视觉模型就直传，否则先转写
    if (panelVision) return { mode: 'inline', imageParts: prep.items, vision: null, dropped: prep.dropped };
    const vis = await doOcr();
    if (vis) return { mode: 'ocr', imageParts: [], vision: vis, dropped: prep.dropped };
    CXAI.Log.warn(`第 ${(question.index || 0) + 1} 题含图片但无可用读图模型，按纯文本判题`);
    return Object.assign({}, none, { dropped: prep.dropped });
  }

  async function runSolveRound(panel, q, vctx) {
    const judgeCfg = CXAI.Cfg.get('ai.judge', {});
    // 长答案题型（附件整卷 / 简答 / 论述 / 计算）默认 700 token 会被截断成半句话，
    // 截断后没法写进答题框，所以这里单独抬高上限。
    const longForm = !!(q && (q.attachMeta || q.type === 'completion' || q.type === 'reader'));
    const tasks = panel.map((p) => async () => {
      const messages = buildSolveMessages(q, undefined, vctx, p);
      const t0 = Date.now();
      const res = await callProvider(p, messages, {
        temperature: p.temperature,
        maxTokens: longForm ? Math.max(Number(p.maxTokens || 0), 4000) : undefined
      });
      const parsed = parseModelResult(res.text, q);
      if (!parsed) throw new Error('答案无法解析：' + CXAI.U.truncate(res.text, 120));
      return {
        ...parsed,
        providerId: p.id,
        providerLabel: p.providerLabel || p.label,
        weight: p.weight || 1,
        ms: Date.now() - t0
      };
    });
    const raw = await runPool(tasks, judgeCfg.concurrency || 3);
    const ok = [];
    const errors = [];
    raw.forEach((r, i) => {
      if (!r) return;
      if (r.__error) errors.push(`${panel[i].providerLabel || panel[i].label}: ${r.__error.message}`);
      else ok.push(r);
    });
    return { drafts: ok, errors };
  }

  async function runCritiqueRound(panel, q, drafts, vctx) {
    const judgeCfg = CXAI.Cfg.get('ai.judge', {});
    const tasks = panel.map((p) => async () => {
      const messages = buildCritiqueMessages(q, drafts, vctx);
      const res = await callProvider(p, messages, { temperature: 0.1 });
      const parsed = parseModelResult(res.text, q);
      if (!parsed) throw new Error('复核结果无法解析');
      return {
        ...parsed,
        providerId: p.id,
        providerLabel: (p.providerLabel || p.label) + '·复核',
        weight: (p.weight || 1) * 1.2,
        ms: 0
      };
    });
    const raw = await runPool(tasks, judgeCfg.concurrency || 3);
    return raw.filter((r) => r && !r.__error);
  }

  async function runArbiter(provider, q, drafts, critiques, vctx) {
    const messages = buildArbiterMessages(q, drafts, critiques, vctx);
    const res = await callProvider(provider, messages, { temperature: 0 });
    const parsed = parseModelResult(res.text, q);
    if (!parsed) return null;
    return {
      ...parsed,
      providerId: provider.id,
      providerLabel: (provider.providerLabel || provider.label) + '·仲裁',
      weight: (provider.weight || 1) * 1.5
    };
  }

  /**
   * 对一道题做多重判定。
   * @returns {Promise<{keys:string[],answerText:string,confidence:number,reason:string,stage:string,votes:any[],errors:string[],lowConfidence:boolean}>}
   */
  async function solve(question) {
    const judgeCfg = CXAI.Cfg.get('ai.judge', {});
    const panel = buildPanel();
    if (panel.length === 0) throw new Error('模型面板为空');

    // ---- Round 0 之前：附件题干（题目在 PDF/Office 附件里）→ 渲染成题图 ----
    // 附件题的 stem 是空的，不先把附件变成 question.images，模型就是闭卷瞎答。
    try {
      if (CXAI.Attach && question && !question.attachMeta) await CXAI.Attach.enrich(question);
    } catch (e) {
      CXAI.Log.warn('附件题干准备失败：' + e.message);
    }

    // ---- Round 0：读图通道（图片 → data URL 或 文字转写） ----
    let vctx = { mode: 'none', imageParts: [], vision: null, dropped: 0 };
    try {
      vctx = await resolveVision(question, panel);
    } catch (e) {
      CXAI.Log.warn('读图准备失败：' + e.message);
    }

    // ---- Round 1：并行独立作答 ----
    const round1 = await runSolveRound(panel, question, vctx);
    if (round1.drafts.length === 0) {
      throw new Error('全部模型调用失败：' + round1.errors.join(' | '));
    }
    let errors = round1.errors.slice();
    let votes = round1.drafts.slice();
    let t = tally(votes);

    const visionMeta = {
      mode: vctx.mode,
      images: (question.images || []).length,
      sent: vctx.imageParts ? vctx.imageParts.length : 0,
      dropped: vctx.dropped || 0,
      ocrChars: vctx.vision ? String((vctx.vision.text || '') + (vctx.vision.questionText || '')).length : 0,
      ocrBy: vctx.vision ? vctx.vision.providerLabel : ''
    };

    const accept = (stage) => ({
      keys: resolveAnswerKeys(t.winner.key, question).keys,
      answerText: t.winner.key,
      confidence: bestConfidence(votes, t.winner.key),
      reason: bestReason(votes, t.winner.key),
      stage,
      ratio: +t.ratio.toFixed(3),
      votes: votes.map(voteSummary),
      errors,
      vision: visionMeta,
      lowConfidence: bestConfidence(votes, t.winner.key) < (judgeCfg.minConfidence || 0.55) || t.ratio < 0.5
    });

    // 单模型 / 一致度达标 -> 直接采纳
    if (panel.length === 1 || judgeCfg.mode === 'single' || t.ratio >= (judgeCfg.voteThreshold || 0.7)) {
      return accept('panel');
    }

    // ---- Round 2：交叉复核 ----
    if (judgeCfg.enableCritique !== false) {
      CXAI.Log.info(`第 ${question.index + 1} 题分歧（一致率 ${(t.ratio * 100).toFixed(0)}%），发起交叉复核`);
      const critiques = await runCritiqueRound(panel, question, round1.drafts, vctx);
      if (critiques.length) {
        votes = votes.concat(critiques);
        t = tally(votes);
        if (t.ratio >= (judgeCfg.voteThreshold || 0.7)) return accept('critique');
      }

      // ---- Round 3：仲裁 ----
      if (judgeCfg.enableArbiter !== false) {
        const arbiterProvider = panel[0];
        try {
          const arb = await runArbiter(arbiterProvider, question, round1.drafts, critiques, vctx);
          if (arb) {
            votes = votes.concat([arb]);
            t = tally(votes);
            return accept('arbiter');
          }
        } catch (e) {
          errors.push('仲裁失败: ' + e.message);
        }
      }
    }

    // 兜底：取加权最高
    return accept('fallback');
  }

  function bestConfidence(votes, key) {
    const same = votes.filter((v) => v.answerText === key);
    if (!same.length) return 0.5;
    // 支持者越多、置信度越高越可信
    const avg = same.reduce((s, v) => s + v.confidence, 0) / same.length;
    const boost = Math.min(0.12, (same.length - 1) * 0.04);
    return CXAI.U.clamp(avg + boost, 0.01, 1);
  }

  function bestReason(votes, key) {
    const same = votes.filter((v) => v.answerText === key && v.reason);
    if (!same.length) return '';
    same.sort((a, b) => b.confidence - a.confidence);
    return same[0].reason;
  }

  function voteSummary(v) {
    return {
      who: v.providerLabel,
      answer: v.answerText,
      confidence: +v.confidence.toFixed(2),
      reason: v.reason,
      agreeWith: v.agreeWith
    };
  }

  /* ---------------- 连通性自检 ---------------- */

  async function ping(provider) {
    const t0 = Date.now();
    const res = await callProvider(
      provider,
      [
        { role: 'system', content: '你是一个连通性测试端点，只输出 JSON。' },
        { role: 'user', content: '输出 {"answer":"ok","confidence":1,"reason":"ping"}' }
      ],
      { temperature: 0, maxTokens: 60 }
    );
    return { ok: true, ms: Date.now() - t0, text: CXAI.U.truncate(res.text, 80) };
  }

  return { solve, ping, listModels, callProvider, parseModelResult, resolveAnswerKeys, tally, buildPanel };
})();
