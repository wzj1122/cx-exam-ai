/**
 * 03c-attach.js —— 附件题干通道（附件 PDF / Office 当题目）
 *
 * 学习通的「附件题」形态（2026-11 期中考试实测）：
 *   卷面只有 1 道简答题，题干 DOM 里全是空的，真正的题目在附件里：
 *     <iframe class="attach-iframe" module="insertAttach"
 *             objectid="ea89…" filename="…期中考试试卷.pdf" filetype="pdf">
 *   点它跳到 /exam-ans/ueditorupload/read?objectId=…
 *
 * 老版脚本拿到的 stem 是空的 —— 模型等于闭卷瞎答。本模块把附件变成「题图」，
 * 直接塞进 question.images，复用 03b-vision 的读图通道，传输层零改动。
 *
 * 取图有两条路，优先第一条（实测最省事）：
 *
 *  ① 页面原生页图（推荐，无需下载 PDF）
 *     GET /mooc-ans/screen/file?objectid=<id>  →  302 到 pan-yz.chaoxing.com 预览外壳
 *     外壳 HTML 里直接内联了逐页图地址：
 *       https://s3.cldisk.com/sv-w9/doc/<hash>/<objectid>/thumb/1.png   （1023×1447，约 270KB）
 *     这些 PNG 直接可下载（不需要 cookie），按页号排序后当题图送模型。
 *     实测 2 页试卷 → 2 张图 → 读图模型逐页识别题目再做答，正是想要的形态。
 *
 *  ② 兜底：预览页 `.btnDown` 的 CDN 直链（带临时签名）→ 下 PDF 字节 → pdf.js 逐页渲染
 *     仅当页面 HTML 里找不到 thumb 图、或站点改成动态渲染时才会走到这里；
 *     页面里若没有 pdfjsLib 就跳过（本脚本不再强制 @require pdf.js）。
 *
 * 全程可降级：两条路都失败 → 只把附件名与直链写进题干，warn 交给 UI，绝不中断整卷。
 */
(function () {
  /**
   * 注意：这里**不要**写 `const CXAI = (window.CXAI = window.CXAI || {})`。
   * build.js 把所有模块拼进同一个外层 IIFE，模块之间共享外层的 `var CXAI`；
   * 各自 `window.CXAI = ...` 会另造一个对象，而 `08-main` 末尾的 `window.CXAI = CXAI`
   * 会把那个临时对象整个覆盖掉 —— 症状就是 CXAI.Attach 永远是 undefined。
   */

  const PDF_WORKER = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
  const MAX_PAGES = 6;
  const MAX_BYTES = 16 * 1024 * 1024;
  const CACHE_TTL = 15 * 60 * 1000;
  const WARN_ONCE = new Set();
  const cache = new Map(); // objectid → {at, meta, pages:[url|dataURL]}

  function cfg() {
    const on = CXAI.Cfg ? CXAI.Cfg.get('answer.attach', true) : true;
    return {
      enabled: on !== false,
      maxPages: MAX_PAGES,
      maxBytes: MAX_BYTES,
      renderEdge: 1600,
      quality: 0.85,
      timeoutMs: 45000
    };
  }

  function warnOnce(key, msg) {
    if (WARN_ONCE.has(key)) return;
    WARN_ONCE.add(key);
    try {
      CXAI.Log && CXAI.Log.warn(msg);
    } catch (e) {}
  }

  /* ---------------- 请求（GM 优先，降级 fetch） ---------------- */

  function gmRequest(url, opts) {
    opts = opts || {};
    return new Promise((resolve, reject) => {
      if (typeof GM_xmlhttpRequest !== 'function') {
        reject(new Error('当前环境没有 GM_xmlhttpRequest'));
        return;
      }
      const headers = { Accept: '*/*' };
      try {
        if (typeof location !== 'undefined' && location.href) headers.Referer = location.href;
      } catch (e) {}
      if (opts.headers) Object.assign(headers, opts.headers);
      GM_xmlhttpRequest({
        method: 'GET',
        url: url,
        headers: headers,
        responseType: opts.type || 'text',
        timeout: opts.timeout || cfg().timeoutMs,
        onload: (res) => resolve(res),
        onerror: () => reject(new Error('附件请求失败（跨域或需要登录）')),
        ontimeout: () => reject(new Error('附件请求超时'))
      });
    });
  }

  async function fetchText(url, timeoutMs) {
    if (typeof GM_xmlhttpRequest === 'function') {
      const res = await gmRequest(url, { type: 'text', timeout: timeoutMs });
      if (res.status >= 200 && res.status < 300) return String(res.responseText || res.response || '');
      throw new Error('HTTP ' + res.status);
    }
    const r = await fetch(url, { credentials: 'include' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.text();
  }

  async function fetchBytes(url, timeoutMs) {
    if (typeof GM_xmlhttpRequest === 'function') {
      const res = await gmRequest(url, { type: 'arraybuffer', timeout: timeoutMs });
      if (res.status >= 200 && res.status < 300 && res.response) return new Uint8Array(res.response);
      throw new Error('HTTP ' + res.status);
    }
    const r = await fetch(url, { credentials: 'include' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return new Uint8Array(await r.arrayBuffer());
  }

  /* ---------------- 附件枚举 ---------------- */

  /** iframe 的 name 属性是 base64(URL-encoded JSON)，里面有 objectid/name/type */
  function fromNameAttr(el) {
    const raw = el.getAttribute && el.getAttribute('name');
    if (!raw || raw.length < 24) return null;
    try {
      const obj = JSON.parse(decodeURIComponent(atob(raw)));
      if (!obj || !obj.objectid) return null;
      return { objectid: String(obj.objectid), filename: String(obj.name || ''), filetype: String(obj.type || '') };
    } catch (e) {
      return null;
    }
  }

  function fromPreviewHref(href) {
    if (!href || href.indexOf('ueditorupload/read') < 0) return null;
    try {
      const u = new URL(href, location.href);
      const id = u.searchParams.get('objectId') || u.searchParams.get('objectid');
      if (!id) return null;
      return { objectid: id, filename: u.searchParams.get('fileOriName') || '', filetype: '' };
    } catch (e) {
      return null;
    }
  }

  /** 从一道题的容器里列出附件（去重，保序） */
  function collect(root) {
    const scope = root || document;
    const out = [];
    const seen = Object.create(null);
    const push = (o) => {
      if (!o || !o.objectid || seen[o.objectid]) return;
      seen[o.objectid] = 1;
      out.push(o);
    };
    let nodes = [];
    try {
      nodes = Array.from(
        scope.querySelectorAll(
          'iframe.attach-iframe, iframe[module="insertAttach"], iframe[objectid], iframe[objectId], .attach-iframe, a[href*="ueditorupload/read"]'
        )
      );
    } catch (e) {}
    nodes.forEach((el) => {
      const byAttr = {
        objectid: el.getAttribute('objectid') || el.getAttribute('objectId') || '',
        filename: el.getAttribute('filename') || el.getAttribute('fileOriName') || '',
        filetype: el.getAttribute('filetype') || el.getAttribute('type') || ''
      };
      if (!byAttr.objectid) {
        const n = fromNameAttr(el);
        if (n) Object.assign(byAttr, n);
      }
      if (!byAttr.objectid) {
        const h = fromPreviewHref(el.getAttribute('href') || el.getAttribute('src') || '');
        if (h) Object.assign(byAttr, h);
      }
      push(byAttr);
    });
    return out;
  }

  function previewUrl(a) {
    const origin = location.origin || 'https://mooc1-api.chaoxing.com';
    let url = origin + '/exam-ans/ueditorupload/read?objectId=' + encodeURIComponent(a.objectid);
    if (a.filename) url += '&fileOriName=' + encodeURIComponent(a.filename);
    return url;
  }

  /* ---------------- ① 页面原生页图 ---------------- */

  function pageNoOf(url) {
    const m = /\/thumb\/(\d+)\.(?:png|jpe?g)/i.exec(String(url)) || /(\d+)\.(?:png|jpe?g)$/i.exec(String(url));
    return m ? parseInt(m[1], 10) : 999;
  }

  /* --- 精简 MD5（只用于算 s3 路径，输入是 objectid 这种 ASCII） --- */
  const MD5_S = [
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9,
    14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15,
    21, 6, 10, 15, 21
  ];

  function md5hex(input) {
    let str = '';
    try {
      str = unescape(encodeURIComponent(String(input == null ? '' : input)));
    } catch (e) {
      str = String(input);
    }
    const K = [];
    for (let i = 0; i < 64; i++) K[i] = (Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296)) | 0;

    const n = str.length;
    const words = [];
    for (let i = 0; i < n; i++) words[i >> 2] = (words[i >> 2] || 0) | (str.charCodeAt(i) << ((i % 4) * 8));
    words[n >> 2] = (words[n >> 2] || 0) | (0x80 << ((n % 4) * 8));
    const total = (((n + 8) >> 6) + 1) * 16;
    for (let i = 0; i < total; i++) if (!words[i]) words[i] = 0;
    words[total - 2] = (n * 8) | 0;

    let a = 1732584193;
    let b = -271733879;
    let c = -1732584194;
    let d = 271733878;

    for (let i = 0; i < total; i += 16) {
      const oa = a;
      const ob = b;
      const oc = c;
      const od = d;
      for (let j = 0; j < 64; j++) {
        let f;
        let g;
        if (j < 16) {
          f = (b & c) | (~b & d);
          g = j;
        } else if (j < 32) {
          f = (d & b) | (~d & c);
          g = (5 * j + 1) % 16;
        } else if (j < 48) {
          f = b ^ c ^ d;
          g = (3 * j + 5) % 16;
        } else {
          f = c ^ (b | ~d);
          g = (7 * j) % 16;
        }
        const tmp = d;
        d = c;
        c = b;
        const x = (a + f + K[j] + (words[i + g] | 0)) | 0;
        b = (b + ((x << MD5_S[j]) | (x >>> (32 - MD5_S[j])))) | 0;
        a = tmp;
      }
      a = (a + oa) | 0;
      b = (b + ob) | 0;
      c = (c + oc) | 0;
      d = (d + od) | 0;
    }

    const rhex = (num) => {
      let s = '';
      for (let i = 0; i < 4; i++) s += ((num >> (i * 8)) & 0xff).toString(16).padStart(2, '0');
      return s;
    };
    return rhex(a) + rhex(b) + rhex(c) + rhex(d);
  }

  /**
   * s3 目录分片 = md5(objectid) 的**最后三个字节**（每个字节两位 hex）。
   * 实测：objectid=ea89639be4740e40493286718eee0655
   *       md5=98a23d4e4619b8c581d4cd398cf90dc3  →  末三字节 f9 / 0d / c3
   *       图片 = https://s3.cldisk.com/sv-w9/doc/f9/0d/c3/<objectid>/thumb/N.png
   * 这条规则让脚本完全不用下载 PDF、不用临时签名、不用请求外壳页。
   */
  function hashPath(objectid) {
    try {
      const hex = md5hex(objectid);
      if (!hex || hex.length !== 32) return '';
      return hex.slice(26, 28) + '/' + hex.slice(28, 30) + '/' + hex.slice(30, 32);
    } catch (e) {
      return '';
    }
  }

  /**
   * 用 <img> 探一页是否存在（img 不受 CORS 限制，也不吃 CSP connect-src）。
   * 故意不设 setTimeout 超时 —— 页面上常见的"计时器加速/掌控"类扩展会把 setTimeout
   * 改成立即执行（实测某环境 ms=1 就 timeout），用定时器做超时必然误判。
   * 404 会立刻触发 onerror，正常图会 onload，浏览器自身还有网络超时兜底。
   */
  function probeImage(url) {
    return new Promise((resolve) => {
      if (typeof Image !== 'function') {
        resolve({ ok: false, error: 'no Image' });
        return;
      }
      const img = new Image();
      let done = false;
      const fin = (r) => {
        if (done) return;
        done = true;
        resolve(r);
      };
      img.onload = () => fin({ ok: true, w: img.naturalWidth, h: img.naturalHeight });
      img.onerror = () => fin({ ok: false, error: 'load error' });
      img.src = url;
    });
  }

  /**
   * 附件逐页图地址。
   * ① 先按 md5 分片规则直拼（零请求、最快）；
   * ② 拼出来的第一页就取不到时，退回请求预览外壳页从 HTML 里抠地址（规则变了也能兜住）。
   */
  /**
   * 某一页是否存在。
   * s3 对不存在的页返回 **404 + image/png**（1200×675 的占位图，44KB），
   * 所以 `<img>` 的 onload 判断不出真假（实测 8 页全"成功"）。用 HEAD 判状态码最准；
   * HEAD 被 CSP/CORS 拦掉时退回 <img> + 排除那个 1200×675 占位图。
   */
  async function pageExists(url) {
    try {
      const r = await fetch(url, { method: 'HEAD' });
      if (r.ok) return true;
      if (r.status === 404) return false;
    } catch (e) {}
    const got = await probeImage(url);
    if (!got.ok) return false;
    return !(got.w === 1200 && got.h === 675);
  }

  async function pageImageUrls(a) {
    const out = [];
    const hp = hashPath(a.objectid);
    if (hp) {
      const base = 'https://s3.cldisk.com/sv-w9/doc/' + hp + '/' + a.objectid + '/thumb/';
      for (let i = 1; i <= MAX_PAGES + 2; i++) {
        const url = base + i + '.png';
        const ok = await pageExists(url);
        if (ok) out.push(url);
        else break; // 页号连续，遇到第一张缺失就是页数到头
      }
      if (out.length) return out;
      return [base + '1.png']; // 全都判不出来也别放弃，交给读图通道试第 1 页
    }

    const origin = location.origin || 'https://mooc1-api.chaoxing.com';
    const url = origin + '/mooc-ans/screen/file?objectid=' + encodeURIComponent(a.objectid);
    const html = await fetchText(url);
    const seen = Object.create(null);
    const re = /((?:https?:)?\/\/[a-z0-9.\-]*cldisk\.com\/[^"'\s()<>]+?\.(?:png|jpe?g|webp))/gi;
    let m;
    while ((m = re.exec(html))) {
      let u = m[1];
      if (u.indexOf('//') === 0) u = 'https:' + u;
      if (seen[u]) continue;
      seen[u] = 1;
      out.push(u);
    }
    out.sort((x, y) => pageNoOf(x) - pageNoOf(y));
    return out;
  }

  /* ---------------- ② 兜底：CDN 直链 + PDF 渲染 ---------------- */

  /** 预览页 → .btnDown 的 CDN 直链（临时签名，约 2 小时有效） */
  async function directUrl(a) {
    const html = await fetchText(previewUrl(a));
    const patterns = [
      /class="[^"]*btnDown[^"]*"[^>]*href="([^"]+)"/i,
      /<a[^>]+href="([^"]+)"[^>]*class="[^"]*btnDown[^"]*"/i,
      /href="(https?:\/\/[^"]*\/download\/[^"]+)"/i
    ];
    let hit = '';
    for (const re of patterns) {
      const m = re.exec(html);
      if (m && m[1]) {
        hit = m[1];
        break;
      }
    }
    if (!hit) throw new Error('附件页里没有下载按钮');
    let u = hit.replace(/&amp;/g, '&');
    if (!/^https?:/i.test(u)) u = location.origin + (u.charAt(0) === '/' ? '' : '/') + u;
    return u;
  }

  function pdfLib() {
    const lib = window.pdfjsLib;
    if (!lib || typeof lib.getDocument !== 'function') return null;
    try {
      if (lib.GlobalWorkerOptions && !lib.GlobalWorkerOptions.workerSrc) {
        lib.GlobalWorkerOptions.workerSrc = PDF_WORKER;
      }
    } catch (e) {}
    return lib;
  }

  async function renderPages(bytes, c) {
    const lib = pdfLib();
    if (!lib) throw new Error('页面里没有 pdf.js，跳过 PDF 渲染');
    const doc = await lib.getDocument({ data: bytes, isEvalSupported: false }).promise;
    const total = doc.numPages || 0;
    const n = Math.min(total, c.maxPages);
    const pages = [];
    for (let i = 1; i <= n; i++) {
      const page = await doc.getPage(i);
      const base = page.getViewport({ scale: 1 });
      const scale = Math.min(2.4, Math.max(1, c.renderEdge / Math.max(base.width, base.height)));
      const vp = page.getViewport({ scale: scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(vp.width);
      canvas.height = Math.ceil(vp.height);
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport: vp }).promise;
      pages.push({ page: i, dataUrl: canvas.toDataURL('image/jpeg', c.quality) });
    }
    try {
      doc.destroy();
    } catch (e) {}
    return { pages: pages.map((p) => p.dataUrl), total: total };
  }

  /* ---------------- 与题目对象对接 ---------------- */

  function attachStemText(question, meta) {
    const pageInfo = meta.pages ? '（共 ' + meta.pages + ' 页）' : '';
    const tag = '【附件材料】' + (meta.filename || '附件') + pageInfo;
    const cur = String(question.stem || '').trim();
    if (!cur) question.stem = tag;
    else if (cur.indexOf('【附件材料】') < 0) question.stem = cur + '\n' + tag;
  }

  /**
   * 页图 URL → dataURL。
   * 走页面 fetch（s3.cldisk.com 允许跨域，实测 200），而不是 GM_xmlhttpRequest：
   * GM 请求会带自定义 Referer，跨域时触发 preflight，s3 不认 OPTIONS —— 图直接丢。
   * 转成 dataURL 后 03b 的 Vision.load() 是直通分支，不再发任何请求，最稳。
   */
  async function pageToDataUrl(url, edge, quality) {
    const r = await fetch(url, { credentials: 'include' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const blob = await r.blob();
    if (!blob || !blob.size) throw new Error('空图片');
    if (typeof createImageBitmap === 'function' && typeof document !== 'undefined') {
      try {
        const bmp = await createImageBitmap(blob);
        const scale = Math.min(1, (edge || 1400) / Math.max(bmp.width, bmp.height));
        const w = Math.max(1, Math.round(bmp.width * scale));
        const h = Math.max(1, Math.round(bmp.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(bmp, 0, 0, w, h);
        try {
          if (bmp.close) bmp.close();
        } catch (e) {}
        const out = canvas.toDataURL('image/jpeg', quality || 0.85);
        if (out && out.length > 2000) return out;
      } catch (e) {}
    }
    return await new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result || ''));
      fr.onerror = () => reject(new Error('读取图片失败'));
      fr.readAsDataURL(blob);
    });
  }

  function applyImages(question, meta, images) {
    question.attachMeta = meta;
    if (!question.images) question.images = [];
    (images || []).forEach((src) => {
      const s = typeof src === 'string' ? src : src && src.dataUrl;
      if (s && question.images.indexOf(s) < 0) question.images.push(s);
    });
    attachStemText(question, meta);
  }

  /**
   * 把附件变成题图。返回 attachMeta（没有附件时返回 null）。
   * 幂等：同一道题重复调用只跑一次（attachMeta 已存在直接返回）。
   */
  async function enrich(question) {
    if (!question) return null;
    if (question.attachMeta) return question.attachMeta;
    const c = cfg();
    const list = question.attachments && question.attachments.length ? question.attachments : collect(question.root);
    if (!list.length) return null;
    question.attachments = list;
    if (!c.enabled) {
      question.attachMeta = { filename: list[0].filename, objectid: list[0].objectid, mode: 'off', pages: 0 };
      attachStemText(question, question.attachMeta);
      return question.attachMeta;
    }

    const a = list[0];
    const meta = {
      filename: a.filename || '附件',
      objectid: a.objectid,
      filetype: a.filetype || '',
      pages: 0,
      mode: 'none',
      source: '',
      url: ''
    };

    const hit = cache.get(a.objectid);
    if (hit && Date.now() - hit.at < CACHE_TTL) {
      applyImages(question, Object.assign(meta, hit.meta), hit.pages);
      return question.attachMeta;
    }

    // ① 页面原生页图（不用下 PDF）
    try {
      const imgs = await pageImageUrls(a);
      if (imgs.length) {
        const sliced = imgs.slice(0, c.maxPages);
        const dataUrls = [];
        for (const u of sliced) {
          try {
            const d = await pageToDataUrl(u, c.renderEdge, c.quality);
            if (d) dataUrls.push(d);
          } catch (e) {
            warnOnce('img:' + u, '页图转存失败：' + e.message);
          }
        }
        const picked = dataUrls.length ? dataUrls : sliced;
        meta.mode = 'pages';
        meta.source = dataUrls.length ? 'screen+inline' : 'screen';
        meta.pages = imgs.length;
        cache.set(a.objectid, { at: Date.now(), meta: meta, pages: picked });
        applyImages(question, meta, picked);
        try {
          CXAI.Log.info(
            '附件题：' + meta.filename + ' · ' + imgs.length + ' 页，' +
              (dataUrls.length ? dataUrls.length + ' 页已内联成图' : '仅拿到图地址')
          );
        } catch (e) {}
        return question.attachMeta;
      }
    } catch (e) {
      warnOnce('screen:' + a.objectid, '附件页图读取失败：' + e.message);
    }

    // ② 兜底：直链 → PDF 字节 → pdf.js 渲染
    let bytes = null;
    try {
      meta.url = await directUrl(a);
    } catch (e) {
      warnOnce('direct:' + a.objectid, '附件直链获取失败：' + e.message);
    }
    if (meta.url) {
      try {
        const got = await fetchBytes(meta.url);
        if (got && got.length > 512) bytes = got;
      } catch (e) {
        warnOnce('bytes:' + a.objectid, '附件下载失败：' + e.message);
      }
    }
    if (bytes && bytes.length <= c.maxBytes) {
      meta.bytes = bytes.length;
      try {
        const r = await renderPages(bytes, c);
        meta.mode = 'pages';
        meta.source = 'pdf';
        meta.pages = r.total;
        cache.set(a.objectid, { at: Date.now(), meta: meta, pages: r.pages });
        applyImages(question, meta, r.pages);
        try {
          CXAI.Log.info('附件题：' + meta.filename + ' · ' + r.total + ' 页（PDF 渲染）');
        } catch (e) {}
        return question.attachMeta;
      } catch (e) {
        warnOnce('render:' + a.objectid, '附件渲染失败：' + e.message);
      }
    }

    // ③ 全失败：只留线索
    meta.mode = meta.url ? 'link' : 'none';
    question.attachMeta = meta;
    attachStemText(question, meta);
    return meta;
  }

  /** 调试用：拿某份附件已缓存的页图 */
  function pagesOf(objectid) {
    const hit = cache.get(String(objectid || ''));
    return hit ? hit.pages : [];
  }

  function clear() {
    cache.clear();
    WARN_ONCE.clear();
  }

  CXAI.Attach = {
    collect: collect,
    previewUrl: previewUrl,
    pageImageUrls: pageImageUrls,
    pageToDataUrl: pageToDataUrl,
    hashPath: hashPath,
    md5: md5hex,
    probeImage: probeImage,
    directUrl: directUrl,
    enrich: enrich,
    pagesOf: pagesOf,
    clear: clear,
    cfg: cfg
  };
})();