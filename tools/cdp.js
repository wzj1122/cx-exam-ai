#!/usr/bin/env node
/**
 * 极简 CDP 控制器（零依赖，用 Node 18+ 内置 fetch/WebSocket）。
 *
 * 用法：
 *   node tools/cdp.js targets                  列出可调试页面
 *   node tools/cdp.js goto <url>               当前页跳转
 *   node tools/cdp.js eval "<js>"              在页面求值（支持 await / 返回对象）
 *   node tools/cdp.js shot <out.png>           整页截图
 *   node tools/cdp.js inject [entry]           注入 GM_* 垫片 + userscript 产物
 *   node tools/cdp.js reload                   重新加载当前页
 *
 * 目标页选择：优先 url 命中 --match 子串的页面，否则第一个 http(s) 页面。
 */
const fs = require('fs');
const path = require('path');

const HTTP = process.env.CDP_HTTP || 'http://127.0.0.1:9222';
const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist', 'cx-exam-ai.user.js');

function argv() {
  const a = process.argv.slice(2);
  const opts = { match: '' };
  const rest = [];
  for (let i = 0; i < a.length; i++) {
    if (a[i] === '--match') opts.match = a[++i];
    else rest.push(a[i]);
  }
  return { cmd: rest[0], args: rest.slice(1), opts };
}

async function listTargets() {
  const r = await fetch(HTTP + '/json/list');
  if (!r.ok) throw new Error('CDP 不可用：' + HTTP + '（先启动带 --remote-debugging-port 的 Chrome）');
  return r.json();
}

function pickTarget(list, match) {
  const pages = list.filter((t) => t.type === 'page');
  if (match) {
    const hit = pages.filter((t) => (t.url || '').indexOf(match) >= 0 || (t.title || '').indexOf(match) >= 0);
    if (hit.length) return hit[0];
  }
  return pages.filter((t) => /^https?:/.test(t.url || ''))[0] || pages[0];
}

async function session(fn) {
  const { opts } = argv();
  const list = await listTargets();
  const t = pickTarget(list, opts.match);
  if (!t) throw new Error('没有可用的页面目标');
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = (e) => rej(new Error('WS 连接失败: ' + (e && e.message)));
  });
  let id = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    let m;
    try {
      m = JSON.parse(ev.data);
    } catch (e) {
      return;
    }
    if (m.id && pending.has(m.id)) {
      const p = pending.get(m.id);
      pending.delete(m.id);
      if (m.error) p.rej(new Error(JSON.stringify(m.error)));
      else p.res(m.result);
    }
  };
  const send = (method, params) =>
    new Promise((res, rej) => {
      const i = ++id;
      pending.set(i, { res, rej });
      ws.send(JSON.stringify({ id: i, method, params: params || {} }));
    });
  try {
    return await fn(send, t);
  } finally {
    try {
      ws.close();
    } catch (e) {}
  }
}

async function evaluate(send, expression) {
  const r = await send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true,
    allowUnsafeEvalBlockedByCSP: true
  });
  if (r.exceptionDetails) {
    const ex = r.exceptionDetails;
    const desc = (ex.exception && (ex.exception.description || ex.exception.value)) || ex.text;
    throw new Error(String(desc));
  }
  return r.result ? r.result.value : undefined;
}

/* ---------------- GM_* 垫片 ---------------- */

const SHIM = `(function(){
  if (window.__CXAI_SHIM__) return 'shim-exists';
  window.__CXAI_SHIM__ = 1;
  var K = 'cxai:';
  window.GM_getValue = function(k, d){ try { var v = localStorage.getItem(K + k); return v == null ? d : JSON.parse(v); } catch(e){ return d; } };
  window.GM_setValue = function(k, v){ try { localStorage.setItem(K + k, JSON.stringify(v)); return true; } catch(e){ return false; } };
  window.GM_deleteValue = function(k){ try { localStorage.removeItem(K + k); } catch(e){} };
  window.GM_listValues = function(){ return Object.keys(localStorage).filter(function(k){ return k.indexOf(K) === 0; }).map(function(k){ return k.slice(K.length); }); };
  window.GM_addStyle = function(css){ var s = document.createElement('style'); s.textContent = css; (document.head || document.documentElement).appendChild(s); return s; };
  window.GM_registerMenuCommand = function(){ return 0; };
  window.unsafeWindow = window;
  window.GM_xmlhttpRequest = function(o){
    o = o || {};
    var ctrl = new AbortController();
    var timer = o.timeout ? setTimeout(function(){ try { ctrl.abort(); } catch(e){} }, o.timeout) : null;
    var headers = {};
    var h = o.headers || {};
    for (var k in h) if (Object.prototype.hasOwnProperty.call(h, k) && k.toLowerCase() !== 'referer') headers[k] = h[k];
    fetch(o.url, { method: o.method || 'GET', headers: headers, body: o.data, credentials: 'include', signal: ctrl.signal })
      .then(function(r){
        if (o.responseType === 'blob') return r.blob().then(function(b){ return { r: r, body: b, txt: '' }; });
        if (o.responseType === 'arraybuffer') return r.arrayBuffer().then(function(b){ return { r: r, body: b, txt: '' }; });
        return r.text().then(function(t){ return { r: r, body: t, txt: t }; });
      })
      .then(function(x){
        if (timer) clearTimeout(timer);
        if (o.onload) o.onload({ status: x.r.status, statusText: x.r.statusText, response: x.body, responseText: x.txt, finalUrl: x.r.url });
      })
      .catch(function(e){ if (timer) clearTimeout(timer); if (o.onerror) o.onerror(e); });
    return { abort: function(){ try { ctrl.abort(); } catch(e){} } };
  };
  return 'shim-installed';
})()`;

async function main() {
  const { cmd, args } = argv();
  if (!cmd || cmd === 'help') {
    console.log('用法: node tools/cdp.js <targets|goto|eval|shot|inject|reload> [参数] [--match 子串]');
    return;
  }

  if (cmd === 'targets') {
    const list = await listTargets();
    list
      .filter((t) => t.type === 'page')
      .forEach((t, i) => console.log(`${i}. [${t.type}] ${t.title}\n   ${t.url}`));
    return;
  }

  await session(async (send, target) => {
    if (cmd === 'goto') {
      await send('Page.enable');
      await send('Page.navigate', { url: args[0] });
      console.log('→ ' + args[0]);
      return;
    }
    if (cmd === 'reload') {
      await send('Page.enable');
      await send('Page.reload', { ignoreCache: false });
      console.log('↻ reloaded: ' + target.url);
      return;
    }
    if (cmd === 'eval') {
      const v = await evaluate(send, args[0]);
      console.log(typeof v === 'string' ? v : JSON.stringify(v, null, 2));
      return;
    }
    if (cmd === 'shot') {
      const out = path.resolve(args[0] || 'shot.png');
      const cap = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      fs.writeFileSync(out, Buffer.from(cap.data, 'base64'));
      console.log('shot → ' + out);
      return;
    }
    if (cmd === 'inject') {
      const entry = args[0] ? path.resolve(args[0]) : DIST;
      if (!fs.existsSync(entry)) throw new Error('找不到脚本产物: ' + entry + '（先 node build.js）');
      const code = fs.readFileSync(entry, 'utf8');
      const s1 = await evaluate(send, SHIM);
      const wrapped = `(function(){ try { var __p = console.log; console.log = function(){}; 
        var src = ${JSON.stringify(code)}; 
        (0, eval)(src); 
        console.log = __p; return 'injected'; } catch(e){ return 'ERROR: ' + (e && e.stack ? e.stack : e); } })()`;
      const s2 = await evaluate(send, wrapped);
      console.log(`shim: ${s1}`);
      console.log(`userscript: ${s2}`);
      const check = await evaluate(
        send,
        `(function(){ return { version: (window.CXAI && CXAI.__version) || null, ui: !!document.getElementById('cx-ai-host'), kind: window.CXAI ? CXAI.Scraper.detectPage().kind : null, questions: window.CXAI ? CXAI.Scraper.collect().questions.length : 0 }; })()`
      );
      console.log('state: ' + JSON.stringify(check));
      return;
    }
    throw new Error('未知命令: ' + cmd);
  });
}

main().catch((e) => {
  console.error('✗ ' + e.message);
  process.exit(1);
});
