#!/usr/bin/env node
/**
 * 真实浏览器端到端验证（CDP 驱动 Chrome，零依赖）。
 *
 *   node tools/verify-cdp.mjs            自动起两个静态服务 + 一个 headless Chrome，跑完自动清理
 *   node tools/verify-cdp.mjs --keep     跑完保留服务与浏览器（方便手动接着看）
 *   node tools/verify-cdp.mjs --cdp=9222 复用已开着的 CDP Chrome（不自己拉进程）
 *
 * 为什么要有这一步：单元测试（tools/test-dom.js）跑在自建 DOM 垫片里，
 * 覆盖不到「真实浏览器 + 真实 origin 隔离 + 真实指针事件」这三件事。
 * 这里用**两个不同端口**模拟设置中心（pages.dev）与考试页（chaoxing.com）——
 * 不同端口 = 不同 origin = localStorage / GM 存储天然隔离，
 * 正好复现「设置页配好、考试页读不到」的真实故障，再验证配置码通道能打通。
 *
 * 产物：系统临时目录里的三张截图 + verify-report.json（跑完即删，除非 --keep）
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST_FILE = path.join(ROOT, 'dist', 'cx-exam-ai.user.js');
const SITE = path.join(ROOT, '.site');
const MOCK = path.join(ROOT, 'tools', 'fixtures', 'exam-mock.html');
const ARGS = new Set(process.argv.slice(2));
const KEEP = ARGS.has('--keep');
const CDP_ARG = process.argv.slice(2).find((a) => a.startsWith('--cdp='));
const CDP_PORT = CDP_ARG ? Number(CDP_ARG.split('=')[1]) : 9222;
const CDP = 'http://127.0.0.1:' + CDP_PORT;
const PORT_A = 8790;
const PORT_B = 8791;
const MOCK_PORT = 8792;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'cxai-e2e-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (!fs.existsSync(DIST_FILE)) {
  console.error('缺少 dist/cx-exam-ai.user.js，先跑 node build.js');
  process.exit(1);
}
if (!fs.existsSync(SITE)) {
  console.error('缺少 .site/，先跑 node tools/build-site.js');
  process.exit(1);
}

/* ---------------- 起环境 ---------------- */

const procs = [];
function track(p) {
  procs.push(p);
  return p;
}
function cleanup() {
  for (const p of procs) {
    try {
      p.kill('SIGTERM');
    } catch (e) {}
  }
  if (!KEEP) {
    try {
      fs.rmSync(TMP, { recursive: true, force: true });
    } catch (e) {}
  }
}
process.on('exit', cleanup);
process.on('SIGINT', () => {
  cleanup();
  process.exit(130);
});

function prepareSites() {
  for (const name of ['site-a', 'site-b']) {
    const dir = path.join(TMP, name);
    fs.mkdirSync(dir, { recursive: true });
    fs.cpSync(SITE, dir, { recursive: true });
  }
  fs.copyFileSync(MOCK, path.join(TMP, 'site-b', 'exam.html'));
  fs.copyFileSync(path.join(ROOT, 'tools', 'fixtures', 'exam-mock-whole.html'), path.join(TMP, 'site-b', 'exam-whole.html'));
}

async function waitHttp(url, tries = 60) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url);
      if (r.status < 500) return true;
    } catch (e) {}
    await sleep(150);
  }
  return false;
}

async function ensureChrome() {
  if (await waitHttp(CDP + '/json/version', 3)) return { owned: false };
  const profile = path.join(TMP, 'profile');
  fs.mkdirSync(profile, { recursive: true });
  track(
    spawn(
      'google-chrome',
      [
        '--headless=new',
        '--remote-debugging-port=' + CDP_PORT,
        '--user-data-dir=' + profile,
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-gpu',
        '--disable-dev-shm-usage',
        '--no-sandbox',
        'about:blank'
      ],
      { stdio: 'ignore', detached: false }
    )
  );
  if (!(await waitHttp(CDP + '/json/version', 80))) throw new Error('Chrome CDP 没起来（端口 ' + CDP_PORT + '）');
  return { owned: true };
}

/* ---------------- CDP 客户端 ---------------- */

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let id = 0;
    const pending = new Map();
    const waiters = [];
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && pending.has(msg.id)) {
        const { res, rej } = pending.get(msg.id);
        pending.delete(msg.id);
        msg.error ? rej(new Error(msg.error.message)) : res(msg.result);
        return;
      }
      if (msg.method) {
        for (let i = waiters.length - 1; i >= 0; i--) {
          if (waiters[i].method === msg.method) {
            waiters.splice(i, 1)[0].res(msg.params);
            break;
          }
        }
      }
    };
    ws.onerror = () => reject(new Error('CDP WS 连接失败'));
    ws.onopen = () =>
      resolve({
        send(method, params = {}) {
          const mid = ++id;
          return new Promise((res, rej) => {
            pending.set(mid, { res, rej });
            ws.send(JSON.stringify({ id: mid, method, params }));
          });
        },
        waitEvent(method, timeout = 20000) {
          return new Promise((res, rej) => {
            const w = { method, res };
            waiters.push(w);
            setTimeout(() => {
              const i = waiters.indexOf(w);
              if (i >= 0) {
                waiters.splice(i, 1);
                rej(new Error('timeout ' + method));
              }
            }, timeout);
          });
        }
      });
  });
}

/* ---------------- 主流程 ---------------- */

async function main() {
  // .site 里的 dist 必须和 dist/ 一致：否则页面加载的是旧脚本，再叠加 inject 的新脚本会变成两套 UI
  const siteDist = path.join(SITE, 'dist', 'cx-exam-ai.user.js');
  if (!fs.existsSync(siteDist) || fs.readFileSync(siteDist, 'utf8') !== fs.readFileSync(DIST_FILE, 'utf8')) {
    console.log('[env] .site 里的产物过期，先重建发布目录 …');
    await new Promise((resolve, reject) => {
      const p = spawn(process.execPath, [path.join(ROOT, 'tools', 'build-site.js')], { stdio: 'inherit' });
      p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error('build-site 失败'))));
    });
  }
  prepareSites();
  track(spawn('python3', ['-m', 'http.server', String(PORT_A), '--bind', '127.0.0.1'], { cwd: path.join(TMP, 'site-a'), stdio: 'ignore' }));
  track(spawn('python3', ['-m', 'http.server', String(PORT_B), '--bind', '127.0.0.1'], { cwd: path.join(TMP, 'site-b'), stdio: 'ignore' }));
  if (!(await waitHttp('http://127.0.0.1:' + PORT_A + '/settings.html'))) throw new Error('静态服务 A 没起来');
  if (!(await waitHttp('http://127.0.0.1:' + PORT_B + '/exam.html'))) throw new Error('静态服务 B 没起来');
  console.log('[env] 设置中心 origin A :' + PORT_A + ' · 考试页 origin B :' + PORT_B + '（存储天然隔离）');
  await ensureChrome();

  const DIST = fs.readFileSync(DIST_FILE, 'utf8');
  const SHIM = fs.readFileSync(path.join(ROOT, 'tools', 'shim.js'), 'utf8');
  const list = await (await fetch(CDP + '/json/list')).json();
  const page = list.filter((t) => t.type === 'page')[0];
  if (!page) throw new Error('没有可用的页面目标');
  const c = await connect(page.webSocketDebuggerUrl);
  await c.send('Page.enable');
  await c.send('Runtime.enable');
  await c.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });

  async function evaluate(expression) {
    const r = await c.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture: true });
    if (r.exceptionDetails) {
      const d = r.exceptionDetails;
      throw new Error('页内异常: ' + (d.exception ? d.exception.description || d.exception.value : d.text));
    }
    return r.result.value;
  }
  async function nav(url) {
    const p = c.waitEvent('Page.loadEventFired', 20000);
    await c.send('Page.navigate', { url });
    await p;
    await sleep(150);
  }
  async function inject() {
    // 测试环境里同一个文档可能被注入多次（导航命中 bfcache 时），会变成两套 UI。
    // 真实 Tampermonkey 只在文档开始注入一次，所以这里先清场再注入。
    await evaluate(`(() => {
      try {
        let n = 0;
        for (;;) {
          const h = document.getElementById('cx-ai-host');
          if (!h) break;
          h.remove();
          n++;
          if (n > 5) break;
        }
      } catch (e) {}
      try { delete window.CXAI; } catch (e) {}
      try { delete window.__CXAI_SHIM__; } catch (e) {}
      return true;
    })()`);
    // 末尾补 ;0：IIFE 返回值是 CXAI 巨型对象，returnByValue 序列化会失败
    await evaluate(SHIM + '\n;0');
    await evaluate(DIST + '\n;0');
    await sleep(1500);
  }
  async function shot(file) {
    const r = await c.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(TMP, file), Buffer.from(r.data, 'base64'));
  }
  /**
   * 悬浮球交互：panel 开合是**双击**，而且全走 pointerdown/up 链 ——
   * 合成 click() 不触发，必须发真实鼠标事件。
   */
  async function ballDoubleClick() {
    const pt = await evaluate(`(() => {
      const b = document.getElementById('cx-ai-host').shadowRoot.querySelector('#ball');
      const r = b.getBoundingClientRect();
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    })()`);
    for (const n of [1, 2]) {
      await c.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pt.x, y: pt.y, button: 'left', clickCount: n });
      await c.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pt.x, y: pt.y, button: 'left', clickCount: n });
      await sleep(80);
    }
    await sleep(600);
  }

  const rows = [];
  const ok = (name, pass, detail) => {
    rows.push({ name, pass: !!pass, detail: detail === undefined ? '' : JSON.stringify(detail) });
    console.log((pass ? '  ✓ ' : '  ✗ ') + name + (detail === undefined ? '' : '  ' + JSON.stringify(detail)));
  };

  /* ==================== A. 设置中心 ==================== */
  console.log('\n[A] 设置中心 · http://127.0.0.1:' + PORT_A + '/settings.html');
  await nav('http://127.0.0.1:' + PORT_A + '/settings.html');
  await evaluate('localStorage.clear(); sessionStorage.clear(); true');
  await nav('http://127.0.0.1:' + PORT_A + '/settings.html');
  await inject();

  const a1 = await evaluate(`(() => {
    const r = document.getElementById('cx-ai-settings');
    const t = r ? r.textContent : '';
    return { mounted: !!r, wizard: !!r.querySelector('[data-act="wz-pick"]'),
      cards: r.querySelectorAll('[data-act="wz-pick"]').length,
      hasTokenRhythm: /基元律动/.test(t), hasCustom: /自定义模型/.test(t),
      hasMagpie: /magpie/i.test(t), hasKimi: /Kimi/i.test(t),
      steps: r.querySelectorAll('.cs-steps .st').length };
  })()`);
  ok('A1 首次打开进三步向导', a1.wizard && a1.steps === 3, a1);
  ok('A2 向导 9 张预设卡：含基元律动/自定义模型，无 magpie/Kimi',
    a1.cards === 9 && a1.hasTokenRhythm && a1.hasCustom && !a1.hasMagpie && !a1.hasKimi, a1);

  const pickAndAdd = async (preset, key, model) => {
    await evaluate(`document.querySelector('[data-act="wz-pick"][data-preset="${preset}"]').click(); true`);
    await sleep(250);
    await evaluate(`(() => {
      const set = (s, v) => { const el = document.querySelector(s); if (el) { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); } };
      set('[data-wz="key"]', '${key}'); set('[data-wz="model"]', '${model}');
      document.querySelector('[data-act="wz-add"]').click(); return true;
    })()`);
    await sleep(350);
  };
  await pickAndAdd('deepseek', 'sk-test-a', 'deepseek-chat');
  await pickAndAdd('tokenrhythm', 'sk-test-b', 'tr-model-1');

  const a3 = await evaluate(`(() => {
    const r = document.getElementById('cx-ai-settings');
    return { added: r.querySelectorAll('.cs-added-row').length,
      formCleared: !document.querySelector('[data-wz="key"]'),
      nextEnabled: !document.querySelector('[data-act="wz-next"]').disabled };
  })()`);
  ok('A3 连续添加两个模型、表单清空、下一步可用', a3.added === 2 && a3.formCleared && a3.nextEnabled, a3);

  await evaluate(`document.querySelector('[data-act="wz-next"]').click(); true`);
  await sleep(350);
  const a4 = await evaluate(`(() => ({ step2: !!document.querySelector('[data-act="wz-judge"]'),
    choices: document.querySelectorAll('.cs-choice').length }))()`);
  await evaluate(`document.querySelector('[data-act="wz-judge"][data-v="council"]').click(); true`);
  await sleep(250);
  await evaluate(`document.querySelector('[data-act="wz-next"]').click(); true`);
  await sleep(350);
  const a5 = await evaluate(`(() => { const s = document.querySelector('[data-wz="visionId"]');
    return { step3: !!document.querySelector('[data-act="wz-done"]'), visionOpts: s ? s.options.length : 0 }; })()`);
  ok('A4 第 2 步四档判题强度', a4.step2 && a4.choices === 4, a4);
  ok('A5 第 3 步读图下拉列出全部 2 个模型', a5.step3 && a5.visionOpts === 2, a5);

  await evaluate(`document.querySelector('[data-act="wz-done"]').click(); true`);
  await sleep(600);

  const a6 = await evaluate(`(() => {
    const r = document.getElementById('cx-ai-settings');
    const body = r.querySelector('.cs-pv .cs-pb');
    const cfg = window.CXAI.Cfg.get('ai.providers', []);
    return { navItems: r.querySelectorAll('.cs-nav .it').length,
      providers: r.querySelectorAll('.cs-pv').length,
      hasWeight: body ? /权重/.test(body.textContent) : null,
      hasTemp: body ? /温度/.test(body.textContent) : null,
      syncBtn: !!r.querySelector('.cs-top #cs-sync-top'),
      syncDisabled: (r.querySelector('.cs-top #cs-sync-top') || {}).disabled,
      storePill: (r.querySelector('#cs-pill-store') || {}).textContent,
      cfgLabels: cfg.map((p) => p.label), cfgStyles: cfg.map((p) => p.apiStyle),
      visionId: window.CXAI.Cfg.get('ai.vision.ocrProviderId', ''),
      judgeMode: window.CXAI.Cfg.get('ai.judge.mode', ''),
      onboarded: window.CXAI.Cfg.get('ui.onboarded', false) };
  })()`);
  ok('A6 走完向导 → 简单版三栏、无权重/温度、顶部「同步到考试页」可用',
    a6.navItems === 3 && a6.hasWeight === false && a6.hasTemp === false && a6.syncBtn && a6.syncDisabled === false, a6);
  ok('A7 两个模型落库（含基元律动）、判题 council、读图已指定、协议 openai',
    a6.providers === 2 && a6.cfgLabels.includes('基元律动') && a6.judgeMode === 'council' &&
      !!a6.visionId && a6.onboarded === true && a6.cfgStyles.every((x) => x === 'openai'),
    { labels: a6.cfgLabels, styles: a6.cfgStyles, vision: a6.visionId });

  await evaluate(`document.querySelector('[data-act="toggle-advanced"]').click(); true`);
  await sleep(500);
  const a8 = await evaluate(`(() => { const r = document.getElementById('cx-ai-settings');
    const b = r.querySelector('.cs-pv .cs-pb');
    return { navItems: r.querySelectorAll('.cs-nav .it').length, hasWeight: /权重/.test(b.textContent),
      hasTemp: /温度/.test(b.textContent), hasStyle: /接口协议/.test(b.textContent) }; })()`);
  ok('A8 高级设置展开六栏 + 权重/温度/接口协议', a8.navItems === 6 && a8.hasWeight && a8.hasTemp && a8.hasStyle, a8);
  await evaluate(`document.querySelector('[data-act="toggle-advanced"]').click(); true`);
  await sleep(400);

  const a9click = await evaluate(`(() => {
    const btn = document.getElementById('cs-sync-top');
    if (!btn) return { err: 'no-top-btn' };
    const label = btn.textContent;
    btn.click();
    return { label: label };
  })()`);
  await sleep(4000);
  const a9 = await evaluate(`(() => {
    const code = (window.CXAI.Sync && window.CXAI.Sync.savedCode) ? window.CXAI.Sync.savedCode() : '';
    const bar = document.querySelector('.cs-note code');
    const btn = document.getElementById('cs-sync-top');
    return { code: code, barShown: !!bar, btnLabel: btn ? btn.textContent : '' };
  })()`);
  const topSyncCode = a9.code || '';
  ok('A9 顶栏「生成同步码并上传」→ 产出同步码并显示在模型页顶部',
    /^[A-Za-z0-9_-]{6,48}\.[A-Za-z0-9_-]{16,60}$/.test(topSyncCode) && a9.barShown === true && /上传/.test(a9.btnLabel || ''),
    { codeHead: topSyncCode.slice(0, 12), barShown: a9.barShown, btnLabel: a9.btnLabel });

  const a10 = await evaluate(`(() => {
    const enc = window.CXAI.cfgCodec.encode({ ai: { providers: [{ id: 'x' }] }, guard: { enabled: true } });
    const dec = window.CXAI.cfgCodec.decode(enc);
    return { len: enc.length, back: !!(dec && dec.ai && dec.ai.providers) };
  })()`);
  ok('A10 配置码可编码/解码（UTF-8 安全）', a10.back && a10.len > 0, a10);
  // B 段要的是 cfgCodec 配置码（整份配置编码），与云同步码是两回事，分开取名免得串味
  const legacyCode = await evaluate(`window.CXAI.cfgCodec.encode(window.CXAI.Cfg.data)`);
  await shot('A-settings-simple.png');

  /* ==================== C. 云同步（Cloudflare Pages Functions + KV）==================== */
  console.log('\n[C] 云同步 · 设置页上传 → 考试页（另一 origin）拉取');
  const API = 'https://cx-exam-ai.pages.dev/api/sync';

  // C1 设置页：进高级 → 备份 → 生成同步码并上传
  await nav('http://127.0.0.1:' + PORT_A + '/settings.html');
  await inject();
  // 备份栏只在高级模式出现：没有就先切高级（不依赖上一段遗留的状态）
  if (!(await evaluate(`!!document.querySelector('[data-tab="backup"]')`))) {
    await evaluate(`(() => { const b = document.querySelector('[data-act="toggle-advanced"]'); if (b) b.click(); return true; })()`);
    await sleep(600);
  }
  await evaluate(`(() => { const t = document.querySelector('[data-tab="backup"]'); if (t) t.click(); return !!t; })()`);
  await sleep(500);
  const preC1 = await evaluate(`(() => { const r = document.getElementById('cx-ai-settings');
    return { hasSyncBtn: !!r.querySelector('[data-act="sync-new"]'),
      tab: (r.querySelector('.cs-nav .it.on') || {}).textContent || '?',
      providerCount: (window.CXAI.Cfg.get('ai.providers', []) || []).length }; })()`);
  console.log('    [dbg] 备份页状态 ' + JSON.stringify(preC1));
  await evaluate(`(() => { const b = document.querySelector('[data-act="sync-new"]'); if (b) { b.click(); return true; } return false; })()`);
  await sleep(3500);
  const c1 = await evaluate(`(() => {
    const el = document.getElementById('cs-synccode');
    return { code: el ? el.value : '', hint: (document.getElementById('cs-cloudhint') || {}).textContent || '',
      saved: (window.CXAI.Sync && window.CXAI.Sync.savedCode) ? window.CXAI.Sync.savedCode() : '' };
  })()`);
  const syncCode = c1.saved || c1.code || '';
  const codeOk = /^[A-Za-z0-9_-]{6,48}\.[A-Za-z0-9_-]{16,60}$/.test(syncCode);
  ok('C1 备份页显示同一串同步码（可复制 / 立即上传 / 停用）', codeOk && !!c1.code,
    { codeHead: syncCode.slice(0, 12), backupShowsCode: !!c1.code });

  // C2 云端确实存了密文
  const apiId = syncCode.split('.')[0];
  let cloudBlob = null;
  try {
    const r = await fetch(API + '/' + apiId);
    const j = await r.json();
    cloudBlob = j.blob || null;
    ok('C2 KV 里已有密文（客户端加密后上传）', r.ok && !!cloudBlob, { status: r.status, len: (cloudBlob || '').length });
  } catch (e) {
    ok('C2 KV 里已有密文（客户端加密后上传）', false, { error: String(e && e.message) });
  }

  // C3 考试页（另一个 origin，无配置）粘同步码 → 拉取
  await nav('http://127.0.0.1:' + PORT_B + '/exam.html');
  await evaluate('localStorage.clear(); sessionStorage.clear(); true');
  await nav('http://127.0.0.1:' + PORT_B + '/exam.html');
  await inject();
  // 先直连 API 层拿一次结果，把「拉取失败」的真实原因打出来（比只看 UI 现象有用）
  const directPull = await evaluate(
    `window.CXAI.Sync.pullInto(${JSON.stringify(syncCode)}).then(function(o){return 'OK:'+((o.ai&&o.ai.providers)||[]).length;}).catch(function(e){return 'ERR:'+(e&&e.message);})`
  );
  console.log('    [dbg] 直连拉取 ' + directPull);
  const logs = await evaluate(`window.CXAI.Log.entries.slice(-4).map(function(e){return e.level+':'+e.msg;})`);
  console.log('    [dbg] 日志 ' + JSON.stringify(logs));

  await ballDoubleClick();
  await evaluate(`(() => {
    const sr = document.getElementById('cx-ai-host').shadowRoot;
    const inp = sr.querySelector('#sync-code');
    inp.value = ${JSON.stringify(syncCode)};
    sr.querySelector('[data-act="sync-pull"]').click();
    return true;
  })()`);
  await sleep(3500);
  const c3 = await evaluate(`(() => {
    const sr = document.getElementById('cx-ai-host').shadowRoot;
    return { providers: window.CXAI.Cfg.get('ai.providers', []).length,
      labels: window.CXAI.Cfg.get('ai.providers', []).map((p) => p.label),
      setupbar: sr.querySelector('#setupbar').classList.contains('show'),
      savedCode: window.CXAI.Store.get('syncCode', '') };
  })()`);
  ok('C3 考试页粘一次同步码 → 从 KV 拉回配置（2 个模型）且提示条消失',
    c3.providers === 2 && c3.labels.includes('基元律动') && c3.setupbar === false && c3.savedCode === syncCode, c3);
  await shot('C-exam-cloud-synced.png');

  // C4 刷新后仍在（同 origin 持久化）
  await nav('http://127.0.0.1:' + PORT_B + '/exam.html');
  await inject();
  const c4 = await evaluate(`window.CXAI.Cfg.get('ai.providers', []).length`);
  ok('C4 刷新后配置仍在（同 origin 已落库）', c4 === 2, { providers: c4 });

  // C5 模拟「新的子域」：清掉配置、只留同步码 → 打开即自动拉取
  await evaluate(`(() => { localStorage.removeItem('cxai:cxai.config.v3'); localStorage.removeItem('cxai.config.v3'); return true; })()`);
  await nav('http://127.0.0.1:' + PORT_B + '/exam.html');
  await inject();
  await sleep(2500);
  const c5 = await evaluate(`(() => {
    const sr = document.getElementById('cx-ai-host').shadowRoot;
    return { providers: window.CXAI.Cfg.get('ai.providers', []).length,
      needsSetup: sr.querySelector('#ball').classList.contains('needs-setup') };
  })()`);
  ok('C5 新子域（有同步码、无本地配置）打开即自动拉取、橙点消失',
    c5.providers === 2 && c5.needsSetup === false, c5);

  // C6 设置页改判定强度 → 自动上传 → 新子域拉到新值
  await nav('http://127.0.0.1:' + PORT_A + '/settings.html');
  await inject();
  await evaluate(`document.querySelector('[data-tab="judge"]').click(); true`);
  await sleep(350);
  const c6set = await evaluate(`(() => {
    const s = document.querySelector('[data-act="strength"]');
    if (!s) return { err: 'no-strength' };
    s.value = 'single';
    s.dispatchEvent(new Event('change', { bubbles: true }));
    return { mode: window.CXAI.Cfg.get('ai.judge.mode'), syncOn: !!(window.CXAI.Sync && window.CXAI.Sync.enabled()) };
  })()`);
  console.log('    [dbg] 设置页改完 ' + JSON.stringify(c6set));
  await sleep(4000); // 等 1.2s 防抖 + 上传
  const c6cloud = await evaluate(`window.CXAI.Sync.pull().then(function(o){return (o.ai.judge&&o.ai.judge.mode)||'?';}).catch(function(e){return 'ERR:'+(e&&e.message);})`);
  console.log('    [dbg] 云端 mode ' + c6cloud);
  // 注意：清 localStorage 必须在**考试页上下文**里做（在设置页做只会清掉设置域，考试域仍留着旧配置，
  // 那样 autoPull 会因为"已有配置"直接跳过 —— 这个坑踩过一次，留注释防复发）
  await nav('http://127.0.0.1:' + PORT_B + '/exam.html');
  await inject();
  let c6 = { mode: '', providers: 0 };
  for (let attempt = 1; attempt <= 4; attempt++) {
    // 配置同时存在两处：GM 垫片的 'cxai:<key>' 和裸 localStorage '<key>'（Store.set 两边都写）。
    // 只删一处会残留旧配置 → autoPull 认为"已有配置"直接跳过。这里全清、只留同步码。
    await evaluate(`(() => {
      const k1 = 'cxai:cxai.config.v3', k2 = 'cxai.config.v3';
      const c1 = localStorage.getItem('cxai:syncCode'), c2 = localStorage.getItem('syncCode');
      localStorage.clear();
      if (c1) localStorage.setItem('cxai:syncCode', c1);
      if (c2) localStorage.setItem('syncCode', c2);
      return { keptCode: !!c1, removedCfg: !localStorage.getItem(k1) && !localStorage.getItem(k2) };
    })()`);
    await nav('http://127.0.0.1:' + PORT_B + '/exam.html?c6=' + attempt);
    await inject();
    await sleep(2000);
    c6 = await evaluate(`({ mode: window.CXAI.Cfg.get('ai.judge.mode'), providers: window.CXAI.Cfg.get('ai.providers', []).length })`);
    if (c6.mode === 'single' && c6.providers === 2) {
      c6.attempt = attempt;
      break;
    }
    await sleep(3000);
  }
  ok('C6 设置页改动自动上传 → 新子域自动拉到新判定模式', c6.mode === 'single' && c6.providers === 2, c6);

  // C7 清理云端测试数据（顺带验证客户端 token 推导与服务端一致）
  try {
    const b64urlToBuf = (str) =>
      Buffer.from(String(str).replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (String(str).length % 4)) % 4), 'base64');
    const token = crypto
      .createHmac('sha256', b64urlToBuf(syncCode.split('.')[1]))
      .update('cx-exam-ai:write:v1')
      .digest('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    const del = await fetch(API + '/' + apiId, { method: 'DELETE', headers: { 'x-cxai-token': token } });
    const dj = await del.json();
    const after = await fetch(API + '/' + apiId);
    // KV 删除同样是最终一致：立刻 GET 可能还命中旧副本，只断言删除请求被接受
    ok('C7 客户端 HMAC 令牌被服务端接受 · 云端测试数据已删除', del.ok && dj.ok === true,
      { delete: del.status, afterImmediate: after.status });
  } catch (e) {
    ok('C7 客户端 HMAC 令牌被服务端接受 · 云端测试数据已删除', false, { error: String(e && e.message) });
  }

  /* ==================== B. 考试页（另一个 origin）==================== */
  console.log('\n[B] 考试页 · http://127.0.0.1:' + PORT_B + '/exam.html（不同 origin，存储隔离）');
  await nav('http://127.0.0.1:' + PORT_B + '/exam.html');
  await evaluate('localStorage.clear(); sessionStorage.clear(); true');
  await nav('http://127.0.0.1:' + PORT_B + '/exam.html');
  await inject();

  const b1 = await evaluate(`(() => {
    const h = document.getElementById('cx-ai-host');
    const sr = h && h.shadowRoot;
    return { host: !!h, ball: sr ? !!sr.querySelector('#ball') : false,
      panelShown: sr ? sr.querySelector('#panel').classList.contains('show') : null,
      dialogShown: sr ? (function () { const m = sr.querySelector('#syncmask'); return !!(m && m.classList.contains('show')); })() : null,
      ballNeeds: sr ? sr.querySelector('#ball').classList.contains('needs-setup') : null,
      providers: window.CXAI.Cfg.get('ai.providers', []).length };
  })()`);
  ok('B1 空配置考试页：悬浮球在，但不自动弹面板', b1.host && b1.ball && b1.panelShown === false && b1.dialogShown === false, b1);
  ok('B2 空配置：球上有待配置橙点', b1.ballNeeds === true, { ballNeeds: b1.ballNeeds });
  ok('B3 两个 origin 的存储确实隔离（考试页读到 0 个模型）', b1.providers === 0, { providers: b1.providers });

  await ballDoubleClick();
  const b4 = await evaluate(`(() => { const sr = document.getElementById('cx-ai-host').shadowRoot;
    return { panel: sr.querySelector('#panel').classList.contains('show'),
      setupbar: sr.querySelector('#setupbar').classList.contains('show'),
      setupBtn: !!sr.querySelector('[data-act="open-settings"]') }; })()`);
  ok('B4 用户双击球 → 面板打开并显示「本域还没配置」提示条', b4.panel && b4.setupbar && b4.setupBtn, b4);

  const b5pre = await evaluate(`(() => {
    const hs = document.querySelectorAll('#cx-ai-host');
    const h = document.getElementById('cx-ai-host');
    const sr = h && h.shadowRoot;
    return { hosts: hs.length, hasShadow: !!sr, ver: (window.CXAI && window.CXAI.__version) || '?',
      ids: sr ? Array.from(sr.querySelectorAll('[id]')).map(function (e) { return e.id; }).slice(0, 12) : [] };
  })()`);
  console.log('    [dbg] B5 前 ' + JSON.stringify(b5pre));
  await evaluate(`(() => { const sr = document.getElementById('cx-ai-host').shadowRoot;
    const b = sr.querySelector('[data-act="syncmask"]'); if (b) b.click(); return !!b; })()`);
  await sleep(500);
  const b5 = await evaluate(`(() => { const h = document.getElementById('cx-ai-host');
    const sr = h && h.shadowRoot;
    if (!sr) return { err: 'no-shadow' };
    const m = sr.querySelector('#syncmask');
    return { syncmask: !!(m && m.classList.contains('show')),
      oldSettingsRemoved: !sr.querySelector('#mask'),
      hasCodeInput: !!sr.querySelector('#sync-code2') }; })()`);
  ok('B5 面板右上角只剩「云同步」入口（脚本内设置面板已移除）',
    b5.syncmask === true && b5.oldSettingsRemoved === true && b5.hasCodeInput === true, b5);
  await shot('B-exam-empty.png');
  await evaluate(`document.getElementById('cx-ai-host').shadowRoot.querySelector('[data-act="syncmask-close"]').click(); true`);
  await sleep(300);

  console.log('\n  → 用设置中心的配置码打开考试页（模拟点「同步到考试页」）');
  await nav('http://127.0.0.1:' + PORT_B + '/exam.html?case=2#cxai_cfg=' + encodeURIComponent(legacyCode));
  await inject();
  const b6 = await evaluate(`(() => {
    const sr = document.getElementById('cx-ai-host').shadowRoot;
    const c = window.CXAI.Cfg.get('ai.providers', []);
    return { providers: c.length, labels: c.map((p) => p.label), hash: location.hash,
      ballNeeds: sr.querySelector('#ball').classList.contains('needs-setup'),
      panelShown: sr.querySelector('#panel').classList.contains('show'),
      dialogShown: (function () { const m = sr.querySelector('#syncmask'); return !!(m && m.classList.contains('show')); })() };
  })()`);
  ok('B6 配置码落库到考试域（2 个模型，含基元律动）', b6.providers === 2 && b6.labels.includes('基元律动'), { labels: b6.labels });
  ok('B7 导入后自动清掉 URL 里的配置码', b6.hash === '', { hash: b6.hash });
  ok('B8 有配置后橙点消失，面板依旧不自动弹出',
    b6.ballNeeds === false && b6.panelShown === false && b6.dialogShown === false, b6);

  await ballDoubleClick();
  const b9 = await evaluate(`(() => { const sr = document.getElementById('cx-ai-host').shadowRoot;
    return { panel: sr.querySelector('#panel').classList.contains('show'),
      sModel: sr.querySelector('#s-model') ? sr.querySelector('#s-model').textContent : '',
      setupbar: sr.querySelector('#setupbar').classList.contains('show') }; })()`);
  ok('B9 双击看统计：判题模型 1 个（另一个是读图）、提示条消失', b9.panel && b9.sModel === '1' && b9.setupbar === false, b9);
  await shot('B-exam-configured.png');

  await nav('http://127.0.0.1:' + PORT_B + '/exam.html');
  await inject();
  const b10 = await evaluate(`(() => {
    const sr = document.getElementById('cx-ai-host').shadowRoot;
    return { providers: window.CXAI.Cfg.get('ai.providers', []).length,
      ballNeeds: sr.querySelector('#ball').classList.contains('needs-setup'),
      active: window.CXAI.Cfg.activeProviders().length,
      vision: window.CXAI.Cfg.visionProviders().length };
  })()`);
  ok('B10 刷新后配置仍在、球无橙点、判题与读图模型各就位',
    b10.providers === 2 && b10.ballNeeds === false && b10.active >= 1 && b10.vision >= 1, b10);


  /* ==================== D. 整卷预览：填空自动落盘（本地 mock 模型）==================== */
  console.log('\n[D] 整卷预览 · 两道填空题（本地 mock 模型）');
  const MOCK_SERVER = `
const http = require('http');
http.createServer(function (req, res) {
  // 脚本的模型请求走 GM_xmlhttpRequest（垫片里 credentials:'include'），
  // 这种请求不能配 ACAO:*，必须回显具体 Origin + allow-credentials
  res.setHeader('access-control-allow-origin', req.headers.origin || '*');
  res.setHeader('access-control-allow-credentials', 'true');
  // credentials 模式下 ACAH 也不能是 *，必须回显预检请求的头
  res.setHeader('access-control-allow-headers', req.headers['access-control-request-headers'] || 'content-type, authorization');
  res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  var body = '';
  req.on('data', function (c) { body += c; });
  req.on('end', function () {
    res.setHeader('content-type', 'application/json');
    if (String(req.url).indexOf('/models') >= 0) {
      return res.end(JSON.stringify({ data: [{ id: 'mock-model' }] }));
    }
    res.end(JSON.stringify({
      id: 'mock', object: 'chat.completion',
      choices: [{ index: 0, message: { role: 'assistant', content: JSON.stringify({ answer: 'TCP/80', confidence: 0.95, reason: 'mock' }) }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
    }));
  });
}).listen(${MOCK_PORT}, '127.0.0.1');
`;
  track(spawn('node', ['-e', MOCK_SERVER], { stdio: 'ignore' }));
  await waitHttp('http://127.0.0.1:' + MOCK_PORT + '/v1/models');

  await nav('http://127.0.0.1:' + PORT_B + '/exam-whole.html');
  await evaluate('localStorage.clear(); sessionStorage.clear(); true');
  await nav('http://127.0.0.1:' + PORT_B + '/exam-whole.html?seed=1');
  await inject(); // 先让 CXAI 起来，才能写配置
  // 直接注入一份指向本地 mock 的配置（跳过云同步，专测落盘）
  await evaluate(`(() => {
    window.CXAI.Cfg.importJSON({
      ai: {
        providers: [{ id: 'mock', label: 'Mock', baseURL: 'http://127.0.0.1:${MOCK_PORT}/v1', model: 'mock-model',
          apiKey: 'x', apiStyle: 'openai', role: 'both', vision: true, weight: 1, temperature: 0.2, maxTokens: 300, enabled: true, keyOptional: true }],
        vision: { enabled: false, strategy: 'off' },
        judge: { mode: 'single', panelSize: 1, enableCritique: false, enableArbiter: false, voteThreshold: 0.7, minConfidence: 0.5, concurrency: 1, timeoutMs: 20000, retries: 0, maxRounds: 1 }
      },
      apply: { saveEach: false, stopOnFail: false },
      guard: { enabled: false }
    });
    return true;
  })()`);
  await nav('http://127.0.0.1:' + PORT_B + '/exam-whole.html?run=1');
  await inject();
  const d0 = await evaluate(`(() => ({ questions: document.querySelectorAll('.questionLi').length,
    providers: window.CXAI.Cfg.activeProviders().length }))()`);
  ok('D1 整卷页 2 道填空题 + mock 模型可用', d0.questions === 2 && d0.providers >= 1, d0);

  // 触发"自动连答"（真跑 AI 流程：两次 mock 请求 → 写入 → 保存）
  await evaluate(`window.CXAI.Engine.start(); true`);
  await sleep(22000);
  const dlog = await evaluate(`window.CXAI.Log.entries.slice(-6).map(function (e) { return e.level + ':' + e.msg.slice(0, 90); })`);
  console.log('    [dbg] 整卷日志 ' + JSON.stringify(dlog));
  const d1 = await evaluate(`(() => {
    const tas = Array.from(document.querySelectorAll('.questionLi textarea'));
    return { saveCount: window.__saveCount || 0,
      filled: tas.filter(function (t) { return String(t.value || '').trim().length > 0; }).length,
      total: tas.length,
      results: (window.CXAI.Engine.st.results || []).length };
  })()`);
  ok('D2 整卷两题都写入', d1.filled === 2 && d1.results >= 2, d1);
  ok('D3 整卷模式下填空自动点了该题的「保存」（saveEach=false 也生效）', d1.saveCount >= 2, d1);
  await shot('D-exam-whole.png');

  /* ==================== 汇总 ==================== */
  const pass = rows.filter((r) => r.pass).length;
  const fail = rows.length - pass;
  const report = { at: new Date().toISOString(), pass, fail, rows };
  if (KEEP) {
    fs.writeFileSync(path.join(TMP, 'verify-report.json'), JSON.stringify(report, null, 2));
    console.log('\n[keep] 产物在 ' + TMP + '（截图 + verify-report.json）');
  }
  console.log('\n================ 汇总 ================');
  console.log('通过 ' + pass + ' / ' + rows.length + (fail ? ' · 失败 ' + fail : ' · 全绿'));
  if (fail) {
    rows.filter((r) => !r.pass).forEach((r) => console.log('  ✗ ' + r.name + ' :: ' + r.detail));
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error('验证失败：' + (e && e.message ? e.message : e));
  process.exitCode = 1;
});