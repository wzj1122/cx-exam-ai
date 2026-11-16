/* GM_* API 垫片：把 Tampermonkey 的扩展 API 用页面内能力模拟出来。
 * 被 tools/watch.js / tools/cdp.js 注入到页面全局作用域（不是 IIFE），
 * 供 dist/cx-exam-ai.user.js 里的 GM_getValue / GM_setValue / GM_xmlhttpRequest 等直接解析。
 */
if (!window.__CXAI_SHIM__) {
  window.__CXAI_SHIM__ = 1;
  var __CX_K = 'cxai:';
  window.GM_getValue = function (k, d) {
    try {
      var v = localStorage.getItem(__CX_K + k);
      return v == null ? d : JSON.parse(v);
    } catch (e) {
      return d;
    }
  };
  window.GM_setValue = function (k, v) {
    try {
      localStorage.setItem(__CX_K + k, JSON.stringify(v));
      return true;
    } catch (e) {
      return false;
    }
  };
  window.GM_deleteValue = function (k) {
    try {
      localStorage.removeItem(__CX_K + k);
    } catch (e) {}
  };
  window.GM_listValues = function () {
    return Object.keys(localStorage)
      .filter(function (k) {
        return k.indexOf(__CX_K) === 0;
      })
      .map(function (k) {
        return k.slice(__CX_K.length);
      });
  };
  window.GM_addStyle = function (css) {
    var s = document.createElement('style');
    s.textContent = css;
    (document.head || document.documentElement).appendChild(s);
    return s;
  };
  window.GM_registerMenuCommand = function () {
    return 0;
  };
  window.GM_xmlhttpRequest = function (o) {
    o = o || {};
    var ctrl = new AbortController();
    var timer = o.timeout
      ? setTimeout(function () {
          try {
            ctrl.abort();
          } catch (e) {}
        }, o.timeout)
      : null;
    var headers = {};
    var h = o.headers || {};
    // 浏览器禁止脚本设置 Referer/Origin 等受限头，静默丢弃避免请求直接失败
    var BANNED = { referer: 1, origin: 1, 'user-agent': 1, host: 1, cookie: 1 };
    for (var k in h) if (Object.prototype.hasOwnProperty.call(h, k) && !BANNED[k.toLowerCase()]) headers[k] = h[k];
    // GM 规范里有 anonymous 选项：为真时不带 cookie（跨域 + ACAO:* 的场景必须这样）
    fetch(o.url, { method: o.method || 'GET', headers: headers, body: (String(o.method || 'GET').toUpperCase() === 'GET' ? undefined : o.data), credentials: o.anonymous ? 'omit' : 'include', signal: ctrl.signal })
      .then(function (r) {
        if (o.responseType === 'blob') return r.blob().then(function (b) { return { r: r, body: b, txt: '' }; });
        if (o.responseType === 'arraybuffer') return r.arrayBuffer().then(function (b) { return { r: r, body: b, txt: '' }; });
        return r.text().then(function (t) { return { r: r, body: t, txt: t }; });
      })
      .then(function (x) {
        if (timer) clearTimeout(timer);
        if (o.onload) o.onload({ status: x.r.status, statusText: x.r.statusText, response: x.body, responseText: x.txt, finalUrl: x.r.url });
      })
      .catch(function (e) {
        if (timer) clearTimeout(timer);
        if (o.onerror) o.onerror(e);
      });
    return {
      abort: function () {
        try {
          ctrl.abort();
        } catch (e) {}
      }
    };
  };
  window.unsafeWindow = window;
}
