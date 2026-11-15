#!/usr/bin/env node
/**
 * CDP 旁路监听：抓页面里的 XHR/Fetch、console、异常、跳转。
 * 用来回答一个具体问题——"点了选项，页面到底有没有发保存请求"。
 *
 *   node tools/cdp-net.js                       默认盯第一个 http 页面
 *   node tools/cdp-net.js --match exam          盯 url 含 exam 的页面
 *   node tools/cdp-net.js --grep chooseAnswer   只打印命中关键字的请求（仍全量写日志）
 *   node tools/cdp-net.js --out /tmp/x.log      日志路径
 *
 * 日志每行带毫秒时间戳，全量落盘（--grep 只影响屏幕输出）。
 */
const fs = require('fs');

const HTTP = process.env.CDP_HTTP || 'http://127.0.0.1:9222';

function arg(name, def) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 ? process.argv[i + 1] : def;
}

const MATCH = arg('match', '');
const GREP = arg('grep', '');
const OUT = arg('out', '/tmp/cdp-net.log');
const fd = fs.createWriteStream(OUT, { flags: 'a' });

function line(tag, text) {
  const t = new Date().toISOString().slice(11, 23);
  const s = `[${t}] ${tag} ${text}`;
  fd.write(s + '\n');
  if (!GREP || text.indexOf(GREP) >= 0) console.log(s);
}

(async () => {
  const list = await (await fetch(HTTP + '/json/list')).json();
  const pages = list.filter((t) => t.type === 'page');
  const t =
    (MATCH && pages.find((p) => (p.url || '').indexOf(MATCH) >= 0)) ||
    pages.find((p) => /^https?:/.test(p.url || '')) ||
    pages[0];
  if (!t) throw new Error('没有可调试页面（先起 --remote-debugging-port 的 Chrome）');
  line('OPEN', `${t.title} :: ${t.url}`);

  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = () => rej(new Error('WS 连接失败'));
  });

  let id = 0;
  const reqs = new Map();
  const send = (method, params) => ws.send(JSON.stringify({ id: ++id, method, params: params || {} }));

  ws.onmessage = (ev) => {
    let m;
    try {
      m = JSON.parse(ev.data);
    } catch (e) {
      return;
    }
    const { method, params } = m;
    if (!method || !params) return;
    if (method === 'Network.requestWillBeSent') {
      const r = params.request;
      if (r.type === 'XHR' || r.type === 'Fetch' || /\.(php|do|action|json)\b/i.test(r.url)) {
        reqs.set(params.requestId, r.url);
        line('REQ ', `${r.method} ${r.url.slice(0, 200)}${r.postData ? '  body=' + String(r.postData).slice(0, 160) : ''}`);
      }
    } else if (method === 'Network.responseReceived') {
      if (reqs.has(params.requestId)) {
        line('RES ', `${params.response.status} ${String(params.response.url).slice(0, 200)}`);
      }
    } else if (method === 'Network.loadingFailed') {
      const u = reqs.get(params.requestId);
      if (u) line('FAIL', `${params.errorText} ${u.slice(0, 160)}`);
    } else if (method === 'Runtime.consoleAPICalled') {
      const txt = (params.args || []).map((a) => (a.value !== undefined ? a.value : a.description || a.type)).join(' ');
      line('LOG ', `[${params.type}] ${String(txt).slice(0, 300)}`);
    } else if (method === 'Runtime.exceptionThrown') {
      const d = params.exceptionDetails || {};
      line('ERR ', String((d.exception && d.exception.description) || d.text).slice(0, 400));
    } else if (method === 'Page.frameNavigated' && !params.frame.parentId) {
      line('NAV ', params.frame.url.slice(0, 200));
    }
  };

  for (const m of ['Network.enable', 'Runtime.enable', 'Page.enable']) send(m, {});
  line('READY', '监听中（Ctrl-C 结束）');
  process.on('SIGINT', () => {
    try {
      ws.close();
    } catch (e) {}
    process.exit(0);
  });
})().catch((e) => {
  console.error('cdp-net 失败：', e.message);
  process.exit(1);
});
