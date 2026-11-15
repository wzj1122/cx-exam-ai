/* ---------------- 加密字体解密（字形置换） ----------------
 * 学习通考试会把题干/选项替换成私用区乱码字符，再下发一份"字形错位"的字体：
 * 码点 X 的字形实际画的是另一个字。肉眼正常，读文本是乱码。
 *
 * 解法：把密文字用加密字体渲染成位图 -> 网格二值化 -> 与参考特征表做两级最近邻匹配。
 * 算法与参数严格对齐 ocsjs 的离线特征表生成端（MIT License, Copyright (c) 2022 enncy）。
 */

CXAI.Font = (function () {
  /* 渲染参数：必须与特征表生成端一致，改动会导致匹配全线失败 */
  const RENDER = 360;
  const SQ = 480;
  const BASELINE = 384;
  const SHORTLIST = 40;
  const INK_THRESHOLD = 40;

  /** 超星加密字体族标记 & 加密元素 class */
  const CX_MARKER = 'font-cxsecret';
  const CX_SELECTOR = '.' + CX_MARKER;
  /** 特征表地址（FRB2 位打包，约 0.76MB，本地缓存 7 天） */
  const REF_TABLE_URL = 'https://cdn.ocsjs.com/resources/font/font_ref_cx.bin';
  const REF_CACHE_KEY = '{{SECRET_mf3hgc5b}}';
  const REF_CACHE_TTL = 7 * 24 * 3600 * 1000;

  let renderCv = null;
  let refTablePromise = null;
  /** 密文字 -> 真实字，进程内终身复用 */
  const map = Object.create(null);
  let crackJob = null;
  let crackFailed = false;

  function getCanvas() {
    if (!renderCv) {
      const cv = document.createElement('canvas');
      cv.width = SQ;
      cv.height = SQ;
      renderCv = { cv, ctx: cv.getContext('2d', { willReadFrequently: true }) };
    }
    return renderCv;
  }

  /* ---------- FRB2 解析 ---------- */

  function unpackBits(packed, offset, count, dims) {
    const bytesPerGlyph = dims / 8;
    const out = new Uint8Array(count * dims);
    for (let i = 0; i < count; i++) {
      const pBase = offset + i * bytesPerGlyph;
      const oBase = i * dims;
      for (let b = 0; b < bytesPerGlyph; b++) {
        const byte = packed[pBase + b];
        for (let k = 0; k < 8; k++) {
          out[oBase + b * 8 + k] = (byte >> (7 - k)) & 1;
        }
      }
    }
    return out;
  }

  function parseRefTable(buf) {
    const dv = new DataView(buf);
    const magic = String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3));
    if (magic !== 'FRB2') throw new Error('特征表格式无效: ' + magic);
    const count = dv.getUint32(4, true);
    const threshold = dv.getUint32(8, true);
    const gc = dv.getUint32(12, true);
    const gf = dv.getUint32(16, true);
    const cps = new Uint32Array(count);
    let off = 20;
    for (let i = 0; i < count; i++, off += 4) cps[i] = dv.getUint32(off, true);
    const packed = new Uint8Array(buf);
    const coarse = unpackBits(packed, off, count, gc * gc);
    off += (count * gc * gc) / 8;
    const fine = unpackBits(packed, off, count, gf * gf);
    return { count, cps, coarse, fine, gc, gf, threshold };
  }

  /* ---------- 加载特征表（内存 -> IndexedDB 缓存 -> 网络） ---------- */

  function idbGet(key) {
    return new Promise((resolve) => {
      try {
        const req = indexedDB.open('cx-ai-font', 1);
        req.onupgradeneeded = () => req.result.createObjectStore('t');
        req.onerror = () => resolve(null);
        req.onsuccess = () => {
          try {
            const db = req.result;
            const tx = db.transaction('t', 'readonly');
            const g = tx.objectStore('t').get(key);
            g.onsuccess = () => resolve(g.result || null);
            g.onerror = () => resolve(null);
          } catch (e) {
            resolve(null);
          }
        };
      } catch (e) {
        resolve(null);
      }
    });
  }

  function idbSet(key, value) {
    return new Promise((resolve) => {
      try {
        const req = indexedDB.open('cx-ai-font', 1);
        req.onupgradeneeded = () => req.result.createObjectStore('t');
        req.onerror = () => resolve(false);
        req.onsuccess = () => {
          try {
            const db = req.result;
            const tx = db.transaction('t', 'readwrite');
            tx.objectStore('t').put(value, key);
            tx.oncomplete = () => resolve(true);
            tx.onerror = () => resolve(false);
          } catch (e) {
            resolve(false);
          }
        };
      } catch (e) {
        resolve(false);
      }
    });
  }

  function httpGetBuffer(url) {
    return new Promise((resolve, reject) => {
      // 优先 GM_xmlhttpRequest（绕过 CORS，且可指定 arraybuffer）
      if (typeof GM_xmlhttpRequest === 'function') {
        GM_xmlhttpRequest({
          method: 'GET',
          url,
          responseType: 'arraybuffer',
          timeout: 60000,
          onload: (res) => {
            if (res.status >= 200 && res.status < 300 && res.response) resolve(res.response);
            else reject(new Error('HTTP ' + res.status));
          },
          onerror: () => reject(new Error('网络错误')),
          ontimeout: () => reject(new Error('请求超时'))
        });
        return;
      }
      fetch(url)
        .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error('HTTP ' + r.status))))
        .then(resolve, reject);
    });
  }

  function loadRefTable() {
    if (refTablePromise) return refTablePromise;
    refTablePromise = (async () => {
      const cached = await idbGet(REF_CACHE_KEY);
      if (cached && cached.buf && Date.now() - cached.at < REF_CACHE_TTL) {
        try {
          return parseRefTable(cached.buf);
        } catch (e) {
          /* 缓存损坏，走网络 */
        }
      }
      CXAI.Log.info('下载字形特征表（首次约 0.76MB）…');
      const buf = await httpGetBuffer(REF_TABLE_URL);
      const table = parseRefTable(buf);
      idbSet(REF_CACHE_KEY, { at: Date.now(), buf }).catch(() => {});
      CXAI.Log.ok(`特征表就绪：${table.count} 个候选字，粗网格 ${table.gc}，精网格 ${table.gf}`);
      return table;
    })();
    refTablePromise.catch(() => {
      refTablePromise = null;
    });
    return refTablePromise;
  }

  /* ---------- 字形渲染与匹配 ---------- */

  function renderGlyph(family, ch, table) {
    const { ctx } = getCanvas();
    ctx.clearRect(0, 0, SQ, SQ);
    ctx.fillStyle = '#fff';
    ctx.font = `${RENDER}px "${family}"`;
    ctx.textBaseline = 'alphabetic';
    const advance = ctx.measureText(ch).width;
    ctx.fillText(ch, (SQ - advance) / 2, BASELINE);
    const px = ctx.getImageData(0, 0, SQ, SQ).data;

    let hasInk = false;
    for (let i = 3; i < px.length; i += 4) {
      if (px[i] > INK_THRESHOLD) {
        hasInk = true;
        break;
      }
    }
    if (!hasInk) return null;

    // 积分图：一次构建，网格求和 O(1)
    const W = SQ + 1;
    const ii = new Uint32Array(W * W);
    for (let y = 0; y < SQ; y++) {
      let rowSum = 0;
      const srcRow = y * SQ * 4;
      const dstRow = (y + 1) * W;
      const upRow = y * W;
      for (let x = 0; x < SQ; x++) {
        rowSum += px[srcRow + x * 4 + 3];
        ii[dstRow + x + 1] = ii[upRow + x + 1] + rowSum;
      }
    }
    const box = (n) => {
      const b = SQ / n;
      const area = b * b;
      const out = new Uint8Array(n * n);
      for (let gy = 0; gy < n; gy++) {
        for (let gx = 0; gx < n; gx++) {
          const y0 = gy * b;
          const x0 = gx * b;
          const sum = ii[(y0 + b) * W + x0 + b] - ii[y0 * W + x0 + b] - ii[(y0 + b) * W + x0] + ii[y0 * W + x0];
          out[gy * n + gx] = sum / area > table.threshold ? 1 : 0;
        }
      }
      return out;
    };
    return { coarse: box(table.gc), fine: box(table.gf) };
  }

  const coverCache = {};

  /** 双回退对比法：判断加密字体是否真的覆盖该字符（不覆盖的说明是明文，跳过） */
  function isCoveredByFont(family, ch) {
    const render = (fallback) => {
      const key = family + '|' + fallback;
      let cv = coverCache[key];
      if (!cv) {
        cv = document.createElement('canvas');
        cv.width = 200;
        cv.height = 200;
        coverCache[key] = cv;
      }
      const ctx = cv.getContext('2d', { willReadFrequently: true });
      ctx.clearRect(0, 0, 200, 200);
      ctx.fillStyle = '#fff';
      ctx.font = `120px "${family}", ${fallback}`;
      ctx.textBaseline = 'middle';
      ctx.fillText(ch, 10, 100);
      return ctx.getImageData(0, 0, 200, 200).data;
    };
    const a = render('serif');
    const b = render('sans-serif');
    let diff = 0;
    for (let i = 3; i < a.length; i += 4) diff += Math.abs(a[i] - b[i]);
    return diff < 1000;
  }

  function bitDistance(arr, idx, dims, q) {
    let s = 0;
    const base = idx * dims;
    for (let i = 0; i < dims; i++) {
      if (arr[base + i] !== q[i]) s++;
    }
    return s;
  }

  function crackChar(table, feat) {
    const { count, cps, coarse, fine, gc, gf } = table;
    const dists = new Float64Array(count);
    for (let i = 0; i < count; i++) dists[i] = bitDistance(coarse, i, gc * gc, feat.coarse);
    const sorted = Float64Array.from(dists);
    sorted.sort();
    const threshold = sorted[Math.min(SHORTLIST, count) - 1];
    let bestI = -1;
    let best = Infinity;
    let second = Infinity;
    for (let i = 0; i < count; i++) {
      if (dists[i] > threshold) continue;
      const d = bitDistance(fine, i, gf * gf, feat.fine);
      if (d < best) {
        second = best;
        best = d;
        bestI = i;
      } else if (d < second) {
        second = d;
      }
    }
    if (bestI < 0) return null;
    return {
      ch: String.fromCodePoint(cps[bestI]),
      best,
      second,
      margin: second > 0 ? 1 - best / second : 1
    };
  }

  /* ---------- 字体来源提取 ---------- */

  /** 从 head 的 <style> 里找 base64 内联字体 */
  function extractFontFromStyle(doc, marker) {
    const styles = Array.from(doc.head ? doc.head.querySelectorAll('style') : []);
    const styleEl = styles.find((s) => s.textContent && s.textContent.indexOf(marker) >= 0);
    if (!styleEl) return null;
    const m = styleEl.textContent.match(/base64,([\w\W]+?)['")]/);
    if (!m) return null;
    const raw = window.atob(m[1].replace(/\s/g, ''));
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    return bytes.buffer;
  }

  /** 列出页面所有 @font-face（族名 + 源），用于 URL 形式的加密字体 */
  function listFontFaces(doc) {
    const faces = [];
    for (const sheet of Array.from(doc.styleSheets || [])) {
      let rules;
      try {
        rules = Array.from(sheet.cssRules || []);
      } catch (e) {
        continue; // 跨域样式表
      }
      for (const rule of rules) {
        if (!(rule instanceof CSSFontFaceRule)) continue;
        const family = (rule.style.getPropertyValue('font-family') || '').replace(/["']/g, '').trim();
        const srcRaw = rule.style.getPropertyValue('src') || '';
        const m = /url\(["']?([^"')]+)["']?\)/.exec(srcRaw);
        if (!family || !m) continue;
        const base = (doc.location && doc.location.href) || location.href;
        faces.push({ family, src: m[1].startsWith('data:') ? m[1] : new URL(m[1], base).href });
      }
    }
    return faces;
  }

  /* ---------- 解密主流程 ---------- */

  function collectText(doc) {
    const els = Array.from(doc.querySelectorAll(CX_SELECTOR));
    return els.map((el) => el.textContent || '').join('');
  }

  async function crackOnce(doc) {
    let source = extractFontFromStyle(doc, CX_MARKER);
    if (!source) {
      // 回退：找族名含 cxsecret 的 @font-face
      const face = listFontFaces(doc).find((f) => /cxsecret/i.test(f.family));
      if (face) source = face.src;
    }
    if (!source) {
      CXAI.Log.info('未检测到加密字体（此页面题目为明文）');
      return null;
    }
    const table = await loadRefTable();
    const chars = Array.from(new Set(collectText(doc).split(''))).filter((c) => c.trim() !== '');
    if (chars.length === 0) return null;

    const family = 'cx-decrypt-' + Math.random().toString(36).slice(2, 8);
    const face = new FontFace(family, typeof source === 'string' ? `url("${source}")` : source);
    await CXAI.U.withTimeout(face.load(), 20000, '字体加载');
    document.fonts.add(face);

    const t0 = Date.now();
    const result = Object.create(null);
    const low = [];
    for (let i = 0; i < chars.length; i++) {
      const ch = chars[i];
      if (!isCoveredByFont(family, ch)) {
        result[ch] = ch;
        continue;
      }
      const feat = renderGlyph(family, ch, table);
      if (!feat) {
        result[ch] = ch;
        continue;
      }
      const r = crackChar(table, feat);
      if (!r) {
        result[ch] = ch;
        continue;
      }
      result[ch] = r.ch;
      if (r.margin < 0.3) low.push({ from: ch, to: r.ch, margin: +r.margin.toFixed(3) });
      if (i % 10 === 9) await CXAI.U.sleep(0);
    }
    CXAI.Log.ok(`字形解密完成：${chars.length} 字 / ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    if (low.length) CXAI.Log.warn(`${low.length} 个字符置信度偏低（可能为形近字）`, low);
    return result;
  }

  function decryptText(text) {
    if (!text) return text;
    return Array.from(text)
      .map((c) => (map[c] !== undefined ? map[c] : c))
      .join('');
  }

  /** 原地改写文本节点（不动 HTML 结构，避免破坏事件绑定） */
  function decryptElements(els) {
    for (const root of els) {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
      const nodes = [];
      while (walker.nextNode()) nodes.push(walker.currentNode);
      for (const node of nodes) {
        const v = node.nodeValue;
        if (v && /[\uE000-\uF8FF]/.test(v)) node.nodeValue = decryptText(v);
        else if (v) node.nodeValue = decryptText(v);
      }
    }
  }

  /**
   * 幂等增量解密：页面每次渲染新题后调用即可。
   * 无加密元素 -> 立即返回；有映射表 -> 毫秒级增量；首次 -> 完整破解。
   */
  async function ensure(doc) {
    doc = doc || document;
    if (crackFailed) return;
    const els = Array.from(doc.querySelectorAll(CX_SELECTOR));
    if (els.length === 0) return;

    if (Object.keys(map).length === 0) {
      if (!crackJob) crackJob = crackOnce(doc).catch((e) => {
        crackFailed = true;
        CXAI.Log.error('字形解密失败：' + e.message);
        return null;
      });
      const res = await crackJob;
      if (!res) {
        crackJob = null;
        return;
      }
      Object.assign(map, res);
    }
    decryptElements(els);
    // 移除标记，保证 getSecret 不再命中（天然幂等）
    els.forEach((el) => el.classList.remove(CX_MARKER));
  }

  /** 同步版：已有映射表时立即解密（供抓题前快速调用） */
  function ensureSync(doc) {
    doc = doc || document;
    if (Object.keys(map).length === 0) return false;
    const els = Array.from(doc.querySelectorAll(CX_SELECTOR));
    if (els.length === 0) return true;
    decryptElements(els);
    els.forEach((el) => el.classList.remove(CX_MARKER));
    return true;
  }

  return {
    ensure,
    ensureSync,
    decryptText,
    hasSecret(doc) {
      return (doc || document).querySelectorAll(CX_SELECTOR).length > 0;
    },
    mapSize() {
      return Object.keys(map).length;
    },
    /** 供调试：暴露原始映射表 */
    rawMap() {
      return map;
    }
  };
})();
