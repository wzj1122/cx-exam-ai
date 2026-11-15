#!/usr/bin/env node
/**
 * 导航跟随注入守护：轮询 CDP，页面 URL 变化就自动注入 GM_* 垫片 + userscript。
 * 用途：手动用 CDP 调试时，用户自己在浏览器里点来点去，脚本始终保持已加载。
 *
 * 用法：node tools/watch.js [--interval 1500]
 * 日志：.watch.log（同时打屏）
 */
const fs = require('fs');
const path = require('path');

const HTTP = process.env.CDP_HTTP || 'http://127.0.0.1:9222';
const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist', 'cx-exam-ai.user.js');
const LOG = path.join(ROOT, '.watch.log');
const INTERVAL = Number((process.argv.find((a) => /^--interval=/.test(a)) || '').split('=')[1]) || 1500;

function log(msg) {
  const line = `[${new Date().toISOString().slice(11, 19)}] ${msg}`;
  console.log(line);
  try {
    fs.appendFileSync(LOG, line + '\n');
  } catch (e) {}
}

const SHIM = fs.readFileSync(path.join(__dirname, 'shim.js'), 'utf8');

async function listPages() {
  const r = await fetch(HTTP + '/json/list');
  if (!r.ok) throw new Error('CDP HTTP ' + r.status);
  const list = await r.json();
  return list.filter((t) => t.type === 'page' && /^https?:/.test(t.url || ''));
}

async function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = () => rej(new Error('ws fail'));
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
      m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result);
    }
  };
  const send = (method, params) =>
    new Promise((res, rej) => {
      const i = ++id;
      pending.set(i, { res, rej });
      ws.send(JSON.stringify({ id: i, method, params: params || {} }));
    });
  return { send, close: () => ws.close() };
}

async function evaluate(send, expression) {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
  if (r.exceptionDetails) {
    const ex = r.exceptionDetails;
    throw new Error(String((ex.exception && (ex.exception.description || ex.exception.value)) || ex.text));
  }
  return r.result ? r.result.value : undefined;
}

const lastState = new Map();

async function tick() {
  const pages = await listPages();
  for (const t of pages) {
    const key = t.id;
    const sig = t.url + '|' + (t.title || '');
    if (lastState.get(key) === sig) continue;
    lastState.set(key, sig);
    if (!/chaoxing\.com|edu\.cn/.test(t.url)) {
      log(`skip  ${t.url}`);
      continue;
    }
    let conn;
    try {
      conn = await connect(t.webSocketDebuggerUrl);
      const code = fs.readFileSync(DIST, 'utf8');
      const res = await evaluate(
        conn.send,
        `(function(){
          try {
            ${SHIM}
            if (window.CXAI && window.CXAI.__version) return 'already:' + window.CXAI.__version;
            (0, eval)(${JSON.stringify(code)});
            return 'injected';
          } catch (e) { return 'ERROR: ' + (e && e.message); }
        })()`
      );
      await new Promise((r) => setTimeout(r, 700));
      const state = await evaluate(
        conn.send,
        `(function(){ try { var p = CXAI.Scraper.detectPage(); var q = CXAI.Scraper.collect().questions; return {kind:p.kind, mode:p.mode, ui:!!document.getElementById('cx-ai-host'), n:q.length, types:q.map(function(x){return x.type;}), stem:(q[0]&&q[0].stem||'').slice(0,60)}; } catch(e){ return {err:String(e && e.message)}; } })()`
      );
      log(`${res}  ${t.url}`);
      log(`  state ${JSON.stringify(state)}`);
    } catch (e) {
      log(`fail  ${t.url}  ${e.message}`);
    } finally {
      if (conn) conn.close();
    }
  }
}

(async () => {
  log(`watch 启动 · CDP ${HTTP} · interval ${INTERVAL}ms · 产物 ${path.basename(DIST)}`);
  for (;;) {
    try {
      await tick();
    } catch (e) {
      log('tick 错误: ' + e.message);
    }
    await new Promise((r) => setTimeout(r, INTERVAL));
  }
})();
