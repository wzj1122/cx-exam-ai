#!/usr/bin/env node
/**
 * 连续取证记录器：挂在 CDP 上，一直跟着用户翻页/作答，把每一页的
 * 抓题结果、落盘结果、面板清单、脚本内部日志全部追加到磁盘。
 *
 * 用途：用户自己在浏览器里看着答，回答不上来的地方不用现场描述——
 * 事后再从日志里把"哪一题、AI 判了什么、页面实际存了什么、翻页走了哪条路"逐条还原。
 *
 *   node tools/cdp-record.js                    默认日志 logs/cx-<时间戳>.log
 *   node tools/cdp-record.js --out=x.log        指定日志文件
 *   node tools/cdp-record.js --interval=1200    轮询间隔
 *   node tools/cdp-record.js --match=exam       只盯 url 含 exam 的页面
 *
 * 记录内容（每行一个时间戳）：
 *   [页面]    URL / start 参数 / 标题 / 页面种类 / 模式 / 是否只读
 *   [抓题]    题号 / qid / 题型 / 题干前 60 字 / 选项 / 页面已存答案
 *   [引擎]    running / paused / total / answered / todo / failed / current
 *   [清单]    每道题一行：题号|状态|题型|AI答案|页面答案
 *   [脚本]    CXAI.Log 的每一条（info/ok/warn/error）
 *   [异常]    页面 error / unhandledrejection
 * 仅在内容变化时写"状态行"，脚本日志与异常则逐条写。
 */
const fs = require('fs');
const path = require('path');

const HTTP = process.env.CDP_HTTP || 'http://127.0.0.1:9222';
const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist', 'cx-exam-ai.user.js');
const SHIM = fs.readFileSync(path.join(__dirname, 'shim.js'), 'utf8');

function arg(name, def) {
  const hit = process.argv.find((a) => a.startsWith('--' + name + '='));
  return hit ? hit.split('=').slice(1).join('=') : def;
}

const INTERVAL = Number(arg('interval', 1200)) || 1200;
const MATCH = arg('match', '');
const OUT =
  arg('out', '') ||
  path.join(ROOT, 'logs', `cx-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.log`);

fs.mkdirSync(path.dirname(OUT), { recursive: true });
const fd = fs.createWriteStream(OUT, { flags: 'a' });

function log(tag, msg) {
  const t = new Date().toISOString().slice(11, 23);
  const line = `[${t}] ${tag} ${msg}`;
  fd.write(line + '\n');
  if (process.env.CX_VERBOSE !== '0') console.log(line);
}

/* 页面内探针：一次 eval 把"这一页的全部事实"取回来 */
const PROBE = `(function(){
  var out = { at: Date.now() };
  out.url = location.href.replace(/^https?:\\/\\/[^/]+/, '');
  out.start = (function(){ var m = /[?&]start=(\\d+)/.exec(location.href); return m ? Number(m[1]) : null; })();
  out.title = document.title;
  out.cxai = (typeof CXAI !== 'undefined' && CXAI && CXAI.__version) || null;
  var ring = window.__cxRing || (window.__cxRing = []);
  out.ringLen = ring.length;
  if (!out.cxai) return out;
  try {
    var p = CXAI.Scraper.detectPage();
    out.page = { kind: p.kind, mode: p.mode, readonly: !!p.readonly };
    out.total = CXAI.Scraper.totalCount();
    out.pageNo = CXAI.Scraper.currentIndex();
    var qs = CXAI.Scraper.collect().questions;
    out.n = qs.length;
    var q = qs[0];
    if (q) {
      var pv = CXAI.Scraper.pageValue(q) || {};
      out.q = {
        no: out.pageNo, qid: q.qid, type: q.type, typeLabel: q.typeLabel,
        stem: String(q.stem || '').slice(0, 60),
        opts: (q.options || []).map(function(o){ return o.key + ':' + String(o.text || '').slice(0, 12) + (o.answered ? '*' : ''); }),
        pageAnswer: String(pv.value || ''), src: pv.src || '',
        answered: !!q.answered, inputs: (q.inputs || []).length
      };
    }
  } catch (e) { out.err = String(e && e.message); }
  try {
    var st = CXAI.Engine.st;
    out.engine = { running: !!st.running, paused: !!st.paused, failed: st.failed || 0, skipped: st.skipped || 0, total: st.total || 0 };
  } catch (e) {}
  try {
    var s = CXAI.UI.state;
    out.ui = { total: s.total, answered: s.answered, todo: s.todo, failed: s.failed, current: s.current };
    out.qlist = (s.qlist || []).map(function(x){
      return [x.index, x.status, x.typeLabel, String(x.answer || '').slice(0, 16), String(x.actual || '').slice(0, 16)].join('|');
    });
  } catch (e) {}
  return out;
})()`;

const RING_DRAIN = `(function(){
  var ring = window.__cxRing || [];
  var from = window.__cxDrained || 0;
  var out = ring.slice(from);
  window.__cxDrained = ring.length;
  return out;
})()`;

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

/** 注入垫片 + 产物 + 日志钩子（导航后重装） */
function injectExpr() {
  const code = fs.readFileSync(DIST, 'utf8');
  return `(function(){
    try {
      if (!window.__cxRing) {
        window.__cxRing = [];
        window.addEventListener('error', function(e){ window.__cxRing.push(['error', 'page-error: ' + (e && e.message)]); });
        window.addEventListener('unhandledrejection', function(e){ window.__cxRing.push(['error', 'unhandled: ' + (e && e.reason && (e.reason.message || e.reason))]); });
      }
      ${SHIM}
      if (window.CXAI && window.CXAI.__version) return 'already:' + window.CXAI.__version;
      (0, eval)(${JSON.stringify(code)});
      try {
        CXAI.Log.on(function(e){ window.__cxRing.push([e.level || 'info', e.msg]); });
      } catch (e) {}
      return 'injected';
    } catch (e) { return 'ERROR: ' + (e && e.message); }
  })()`;
}

const lastSig = new Map(); // target id -> 上一次写入的状态签名

function fmtState(s) {
  const bits = [];
  bits.push(`[页面] ${s.url}`);
  if (s.page) bits.push(`kind=${s.page.kind} mode=${s.page.mode} readonly=${s.page.readonly} start=${s.start} 题量=${s.total} 当前第${s.pageNo}题 块数=${s.n}`);
  if (s.q) {
    bits.push(`[抓题] #${s.q.no} qid=${s.q.qid} ${s.q.typeLabel}(${s.q.type}) 已答=${s.q.answered} 输入框=${s.q.inputs}`);
    bits.push(`       题干=${s.q.stem}`);
    if (s.q.opts && s.q.opts.length) bits.push(`       选项=${s.q.opts.join(' ')}`);
    bits.push(`       页面答案=${s.q.pageAnswer || '(空)'} 来源=${s.q.src || '-'}`);
  }
  if (s.engine) bits.push(`[引擎] running=${s.engine.running} paused=${s.engine.paused} 失败=${s.engine.failed} 跳过=${s.engine.skipped}`);
  if (s.ui) bits.push(`[统计] 题目${s.ui.total} 已答${s.ui.answered} 未答${s.ui.todo} 失败${s.ui.failed} 当前${s.ui.current}`);
  if (s.qlist && s.qlist.length) bits.push(`[清单] ${s.qlist.join('  ')}`);
  if (s.err) bits.push(`[抓题异常] ${s.err}`);
  return bits;
}

async function tick() {
  const pages = await listPages();
  for (const t of pages) {
    if (MATCH && (t.url || '').indexOf(MATCH) < 0) continue;
    let conn;
    try {
      conn = await connect(t.webSocketDebuggerUrl);
      // 1) 保证脚本在（导航后自动重装）
      let inj = null;
      try {
        inj = await evaluate(conn.send, injectExpr());
      } catch (e) {
        inj = 'inject-fail: ' + e.message;
      }
      if (/^injected/.test(String(inj))) log('[载入]', `${inj} ${t.url.slice(0, 90)}`);
      // 2) 先排日志（页面切换时旧日志会在新页丢失，所以每 tick 都排）
      let drained = [];
      try {
        drained = (await evaluate(conn.send, RING_DRAIN)) || [];
      } catch (e) {}
      drained.forEach((it) => log('[脚本]', String(it[1])));
      // 3) 状态快照（变化才写）
      const s = await evaluate(conn.send, PROBE);
      if (!s) continue;
      const sig = JSON.stringify([s.url, s.q && s.q.pageAnswer, s.answered, s.ui, s.qlist, s.engine, s.n]);
      if (lastSig.get(t.id) !== sig) {
        lastSig.set(t.id, sig);
        fmtState(s).forEach((line) => log('[状态]', line));
      }
    } catch (e) {
      log('[失败]', `${t.url.slice(0, 80)} :: ${e.message}`);
    } finally {
      if (conn) conn.close();
    }
  }
}

(async () => {
  log('[会话]', `记录启动 · CDP ${HTTP} · 间隔 ${INTERVAL}ms · 产物 ${path.basename(DIST)} · 日志 ${OUT}`);
  for (;;) {
    try {
      await tick();
    } catch (e) {
      log('[失败]', 'tick: ' + e.message);
    }
    await new Promise((r) => setTimeout(r, INTERVAL));
  }
})();
