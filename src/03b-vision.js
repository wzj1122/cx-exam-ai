/* ---------------- 读图（多模态）层 ----------------
 * 学习通的图片题有两个硬问题：
 *   1) 图片挂在 mooc1.chaoxing.com 上，多半要带 Cookie/Referer 才给，模型厂商的服务器拉不到；
 *   2) 原图动辄 1~3MB，直传会让 token 费用爆炸、甚至被端点拒收。
 * 所以这里统一做三件事：本地抓图 → 缩放压缩 → 转 data URL（或先转写成文字）。
 *
 * 两种用法：
 *   inline  把 data URL 直接塞给支持视觉的模型（qwen-vl / glm-4v / gpt-4o / magpie 背后的多模态模型）
 *   ocr     先用读图模型把图片"读成文字"，再把文字喂给纯文本模型判题
 */

CXAI.Vision = (function () {
  const imgCache = new Map(); // url -> {at, value}
  const ocrCache = new Map(); // key  -> value

  const SYSTEM_VISION = [
    '你是一名试卷图片转写员。图片来自中国高校在线考试（学习通），可能包含：题干文字、数学公式、化学式、表格、几何图形、电路图、流程图、代码片段、以及印在图片里的选项。',
    '',
    '任务：把图上一切与解题有关的信息，原样转写成纯文本，供后续纯文本模型判题。',
    '要求：',
    '1. 公式用常见线性写法（如 x^2、sqrt(3)、H2SO4、a/b），不要用 LaTeX 花括号。',
    '2. 表格按行输出，列之间用 " | " 分隔，第一行是表头。',
    '3. 图形/电路/几何：描述关键标注、坐标、角度、边长、连接关系，不要只写"一个图"。',
    '4. 图里出现的选项（如 A. xxx）逐条抄下来。',
    '5. 看不清的地方写 [不清]，绝不臆造。',
    '',
    '只输出一个 JSON 对象，不要 markdown 围栏：',
    '{"text":"<完整转写>","questionText":"<图上题干部分，没有就空串>","options":["<选项1>","<选项2>"],"kind":["text|formula|table|figure|code|diagram"],"confidence":<0到1>}'
  ].join('\n');

  /* ---------------- 配置 ---------------- */

  function cfg() {
    const v = CXAI.Cfg.get('ai.vision', {});
    const d = (CXAI.DEFAULT_CONFIG.ai.vision || {});
    const out = Object.assign({}, d, v && typeof v === 'object' ? v : {});
    if (typeof v === 'boolean') out.enabled = v;
    out.maxImages = Math.max(1, Math.min(8, Number(out.maxImages) || 3));
    out.maxEdge = Math.max(320, Math.min(4096, Number(out.maxEdge) || 1400));
    out.quality = Math.max(0.1, Math.min(1, Number(out.quality) || 0.82));
    out.maxTotalBytes = Math.max(200000, Number(out.maxTotalBytes) || 4194304);
    out.fetchTimeoutMs = Math.max(2000, Number(out.fetchTimeoutMs) || 15000);
    out.strategy = ['auto', 'inline', 'ocr', 'off'].indexOf(out.strategy) >= 0 ? out.strategy : 'ocr';
    out.enabled = out.enabled !== false;
    return out;
  }

  function isEnabled() {
    const c = cfg();
    return c.enabled && c.strategy !== 'off';
  }

  function dataUrlBytes(dataUrl) {
    const s = String(dataUrl || '');
    const i = s.indexOf(',');
    if (i < 0) return s.length;
    return Math.round((s.length - i - 1) * 0.75);
  }

  function remember(map, key, value, cap) {
    map.set(key, { at: Date.now(), value: value });
    while (map.size > (cap || 60)) {
      const first = map.keys().next();
      if (first.done) break;
      map.delete(first.value);
    }
  }

  /* ---------------- 抓图 ---------------- */

  function fetchBlob(url, timeoutMs) {
    return new Promise((resolve, reject) => {
      const headers = { Accept: 'image/*,*/*;q=0.8' };
      try {
        if (typeof location !== 'undefined' && location.href) headers.Referer = location.href;
      } catch (e) {}
      if (typeof GM_xmlhttpRequest === 'function') {
        GM_xmlhttpRequest({
          method: 'GET',
          url: url,
          headers: headers,
          responseType: 'blob',
          timeout: timeoutMs,
          onload: (res) => {
            if (res.status >= 200 && res.status < 300 && res.response) resolve(res.response);
            else reject(new Error('HTTP ' + res.status));
          },
          onerror: () => reject(new Error('图片拉取失败（跨域或需要登录）')),
          ontimeout: () => reject(new Error('图片拉取超时'))
        });
        return;
      }
      if (typeof fetch !== 'function') {
        reject(new Error('当前环境没有可用的请求实现'));
        return;
      }
      const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
      const timer = setTimeout(() => {
        if (ctrl) ctrl.abort();
      }, timeoutMs);
      fetch(url, ctrl ? { credentials: 'include', signal: ctrl.signal } : { credentials: 'include' })
        .then((r) => {
          clearTimeout(timer);
          if (!r || r.ok === false) throw new Error('HTTP ' + ((r && r.status) || 0));
          if (typeof r.blob === 'function') return r.blob();
          if (typeof r.arrayBuffer === 'function') return r.arrayBuffer();
          throw new Error('响应无法读取');
        })
        .then(resolve)
        .catch((e) => {
          clearTimeout(timer);
          reject(e);
        });
    });
  }

  const MIME_EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/bmp': 'bmp' };

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      if (typeof blob === 'string') {
        resolve(/^data:/.test(blob) ? blob : 'data:image/png;base64,' + blob);
        return;
      }
      if (typeof FileReader === 'function' && blob && typeof blob === 'object') {
        try {
          const fr = new FileReader();
          fr.onload = () => resolve(String(fr.result || ''));
          fr.onerror = () => reject(new Error('读取图片失败'));
          fr.readAsDataURL(blob);
          return;
        } catch (e) {
          /* 落到 arrayBuffer 分支 */
        }
      }
      if (blob && typeof blob.arrayBuffer === 'function') {
        blob
          .arrayBuffer()
          .then((buf) => {
            const bytes = new Uint8Array(buf);
            let bin = '';
            const CH = 0x8000;
            for (let i = 0; i < bytes.length; i += CH) {
              bin += String.fromCharCode.apply(null, Array.prototype.slice.call(bytes, i, i + CH));
            }
            const mime = (blob.type && MIME_EXT[blob.type] ? blob.type : 'image/png');
            resolve('data:' + mime + ';base64,' + btoa(bin));
          })
          .catch(() => reject(new Error('图片编码失败')));
        return;
      }
      reject(new Error('图片数据为空'));
    });
  }

  /** 用 canvas 缩放 + 重编码，失败时原样返回（宁可直接传大图，也不要没图） */
  function compress(dataUrl, maxEdge, quality) {
    if (typeof Image !== 'function' || typeof document === 'undefined' || !document.createElement) {
      return Promise.resolve(dataUrl);
    }
    return new Promise((resolve) => {
      let settled = false;
      const finish = (v) => {
        if (!settled) {
          settled = true;
          resolve(v || dataUrl);
        }
      };
      let probe = null;
      try {
        probe = document.createElement('canvas');
      } catch (e) {}
      if (!probe || typeof probe.getContext !== 'function') return finish(dataUrl);
      const img = new Image();
      const timer = setTimeout(() => finish(dataUrl), 8000);
      img.onload = () => {
        clearTimeout(timer);
        try {
          const w0 = img.naturalWidth || img.width || 0;
          const h0 = img.naturalHeight || img.height || 0;
          if (!w0 || !h0) return finish(dataUrl);
          const scale = Math.min(1, maxEdge / Math.max(w0, h0));
          const w = Math.max(1, Math.round(w0 * scale));
          const h = Math.max(1, Math.round(h0 * scale));
          const cv = document.createElement('canvas');
          cv.width = w;
          cv.height = h;
          const g = cv.getContext && cv.getContext('2d');
          if (!g) return finish(dataUrl);
          if (typeof g.fillRect === 'function') {
            g.fillStyle = '#fff';
            g.fillRect(0, 0, w, h);
          }
          g.drawImage(img, 0, 0, w, h);
          const out = cv.toDataURL('image/jpeg', quality);
          finish(out && out.length > 128 ? out : dataUrl);
        } catch (e) {
          finish(dataUrl);
        }
      };
      img.onerror = () => {
        clearTimeout(timer);
        finish(dataUrl);
      };
      try {
        img.src = dataUrl;
      } catch (e) {
        clearTimeout(timer);
        finish(dataUrl);
      }
    });
  }

  /** 取单张图：URL -> {url,dataUrl,bytes,ok,error}（带内存缓存） */
  async function load(url, c) {
    c = c || cfg();
    const href = String(url || '');
    if (!href) return { url: href, dataUrl: '', bytes: 0, ok: false, error: '空地址' };
    if (/^data:image\//i.test(href)) {
      return { url: href, dataUrl: href, bytes: dataUrlBytes(href), ok: true, cached: true };
    }
    const hit = imgCache.get(href);
    if (hit && Date.now() - hit.at < 10 * 60 * 1000) return Object.assign({}, hit.value, { cached: true });
    try {
      const blob = await fetchBlob(href, c.fetchTimeoutMs);
      let dataUrl = await blobToDataUrl(blob);
      if (!dataUrl) throw new Error('图片数据为空');
      dataUrl = await compress(dataUrl, c.maxEdge, c.quality);
      const value = { url: href, dataUrl: dataUrl, bytes: dataUrlBytes(dataUrl), ok: true };
      remember(imgCache, href, value, c.cacheSize);
      return value;
    } catch (e) {
      return { url: href, dataUrl: '', bytes: 0, ok: false, error: e.message };
    }
  }

  /** 把一道题的图片全部处理成可发送的 parts */
  async function prepare(question) {
    const c = cfg();
    const empty = { items: [], mode: 'none', dropped: 0, totalBytes: 0, strategy: c.strategy };
    if (!c.enabled || c.strategy === 'off') return Object.assign(empty, { mode: 'off' });
    const urls = (question && question.images ? question.images : []).slice(0, c.maxImages);
    if (!urls.length) return empty;

    const items = [];
    let total = 0;
    let dropped = 0;
    for (const u of urls) {
      const got = await load(u, c);
      if (!got.ok) {
        dropped++;
        CXAI.Log.warn('图片读取失败：' + CXAI.U.truncate(got.url, 70) + ' · ' + got.error);
        continue;
      }
      if (got.bytes < 600) {
        dropped++; // 1x1 占位符 / 分隔线
        continue;
      }
      if (total + got.bytes > c.maxTotalBytes) {
        dropped++;
        continue;
      }
      total += got.bytes;
      items.push(got);
    }
    return { items: items, mode: items.length ? 'ready' : 'none', dropped: dropped, totalBytes: total, strategy: c.strategy };
  }

  /* ---------------- 读图模型 ---------------- */

  /** 挑读图模型：优先设置里指定的，其次权重最高的视觉模型 */
  function pickProvider() {
    const c = cfg();
    const vis = CXAI.Cfg.visionProviders();
    if (c.ocrProviderId) {
      const hit = vis.filter((p) => p.id === c.ocrProviderId)[0] || CXAI.Cfg.allProviders().filter((p) => p.id === c.ocrProviderId)[0];
      if (hit) return hit;
    }
    return vis[0] || null;
  }

  function panelHasVision(panel) {
    return (panel || []).some((p) => p && p.vision);
  }

  /* ---------------- 转写 ---------------- */

  function buildVisionUserText(q) {
    const lines = ['【已知信息】'];
    if (q && q.typeLabel) lines.push('题型：' + q.typeLabel);
    if (q && q.stem) lines.push('页面已抓到的题干文字（可能不完整）：' + CXAI.U.truncate(q.stem, 600));
    const opts = (q && q.options ? q.options : []).map((o) => o.key + '. ' + o.text);
    if (opts.length) lines.push('页面已抓到的选项：\n' + opts.join('\n'));
    else lines.push('页面上没有抓到选项（选项可能印在图片里，请一并转写）。');
    lines.push('【任务】按系统提示的 JSON 契约转写图片内容。');
    return lines.join('\n\n');
  }

  function transcribeKey(q, items) {
    const urls = (items || []).map((i) => i.url).join('|');
    return 'ocr|' + urls + '|' + CXAI.U.normText(q && q.stem).slice(0, 160);
  }

  /**
   * 用读图模型把图片转写成文字。
   * @returns {Promise<{text,questionText,options,kind,confidence,providerLabel,raw}>}
   */
  async function transcribe(question, provider, items) {
    provider = provider || pickProvider();
    if (!provider) throw new Error('没有可用的读图模型：请在设置里添加一个支持图片输入的模型（如 qwen-vl-max / glm-4v-plus / magpie 网关）');
    if (!items || !items.length) throw new Error('没有可转写的图片');
    const key = transcribeKey(question, items);
    const hit = ocrCache.get(key);
    if (hit) return Object.assign({ cached: true }, hit.value);

    const messages = [
      { role: 'system', content: SYSTEM_VISION },
      {
        role: 'user',
        content: [{ type: 'text', text: buildVisionUserText(question) }].concat(
          items.map((i) => ({ type: 'image_url', image_url: { url: i.dataUrl } }))
        )
      }
    ];
    const res = await CXAI.AI.callProvider(provider, messages, { temperature: 0.1, maxTokens: 1500 });
    const obj = CXAI.U.safeJson(res.text) || {};
    const out = {
      text: String(obj.text || obj.transcript || obj.content || '').trim(),
      questionText: String(obj.questionText || '').trim(),
      options: Array.isArray(obj.options) ? obj.options.map((x) => String(x == null ? '' : x).trim()).filter(Boolean) : [],
      kind: Array.isArray(obj.kind) ? obj.kind.map(String) : [],
      confidence: Number(obj.confidence) > 0 && Number(obj.confidence) <= 1 ? Number(obj.confidence) : 0.6,
      providerId: provider.id,
      providerLabel: provider.label,
      raw: res.text
    };
    if (!out.text && !out.questionText && !out.options.length) {
      // 模型没按契约输出：原文兜底，至少别丢信息
      out.text = String(res.text || '').trim().slice(0, 4000);
      out.confidence = Math.min(out.confidence, 0.45);
    }
    remember(ocrCache, key, out, cfg().cacheSize);
    return out;
  }

  /** 把转写结果拼成给判题模型的文字块 */
  function composePromptBlock(vision) {
    if (!vision) return '';
    const lines = ['【图片转写】以下内容由读图模型从题目图片中提取：'];
    if (vision.questionText) lines.push('图内题干：' + vision.questionText);
    if (vision.text) lines.push(vision.text);
    if (vision.options && vision.options.length) lines.push('图内选项：\n' + vision.options.join('\n'));
    if (!vision.questionText && !vision.text && !(vision.options || []).length) return '';
    lines.push('（转写可能有误差，题干与选项以上下文的页面文字为准，冲突时以页面文字优先。）');
    return lines.join('\n');
  }

  function clear() {
    imgCache.clear();
    ocrCache.clear();
  }

  function stats() {
    let bytes = 0;
    imgCache.forEach((v) => {
      bytes += (v.value && v.value.bytes) || 0;
    });
    return { images: imgCache.size, transcripts: ocrCache.size, bytes: bytes };
  }

  return {
    SYSTEM_VISION,
    cfg,
    isEnabled,
    load,
    prepare,
    pickProvider,
    panelHasVision,
    transcribe,
    composePromptBlock,
    buildVisionUserText,
    dataUrlBytes,
    clear,
    stats
  };
})();
