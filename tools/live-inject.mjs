#!/usr/bin/env node
/**
 * 把构建后的 v2 油猴脚本注入到已打开的真实 Chrome（CDP 9222）。
 *
 * 用法：
 *   node tools/live-inject.mjs [考试URL]
 *   CX_CONFIG=/path/to/config.json node tools/live-inject.mjs [考试URL]
 *   CX_SHOT=/tmp/exam.png node tools/live-inject.mjs [考试URL]
 *
 * 说明：GM_xmlhttpRequest 通过 Playwright exposeFunction 走 Node fetch，
 * 绕过页面 CORS；不会写入 Cookie，也不会提交考试。
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

const CDP = process.env.CDP || 'http://127.0.0.1:9222';
const targetUrl = process.argv[2] || '';
const root = resolve(import.meta.dirname, '..');
const userscript = await readFile(resolve(root, 'apps/userscript/dist/cx-exam-ai.user.js'), 'utf8');
const config = process.env.CX_CONFIG
  ? JSON.parse(await readFile(process.env.CX_CONFIG, 'utf8'))
  : { version: 2, providers: [], ui: { autoEnterPreview: true, riskDefaultExcluded: true, theme: 'light' } };

const browser = await chromium.connectOverCDP(CDP);
const context = browser.contexts()[0];
if (!context) throw new Error('CDP 没有可用 context');

let page = context.pages().find((p) => /chaoxing|edu\.cn/.test(p.url())) || context.pages()[0];
if (!page) page = await context.newPage();
await page.bringToFront();

await page.exposeFunction('__cxGmHttp', async (options) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs || 25_000);
  try {
    const response = await fetch(options.url, {
      method: options.method || 'GET',
      headers: options.headers,
      body: options.body,
      signal: controller.signal,
    });
    return { status: response.status, bodyText: await response.text() };
  } finally {
    clearTimeout(timer);
  }
});

const prelude = `(() => {
    const store = new Map();
    store.set('cx-exam-ai:v2:config', ${JSON.stringify(config)});
    window.GM_getValue = (key, fallback) => store.has(key) ? store.get(key) : fallback;
    window.GM_setValue = (key, value) => store.set(key, value);
    window.GM_deleteValue = (key) => store.delete(key);
    window.GM_xmlhttpRequest = (options) => {
      window.__cxGmHttp({
        url: options.url,
        method: options.method || 'GET',
        headers: options.headers,
        body: options.data,
        timeoutMs: options.timeout,
      }).then((result) => {
        options.onload && options.onload({ status: result.status, responseText: result.bodyText });
      }).catch((error) => {
        options.onerror && options.onerror(error);
      });
    };
    window.unsafeWindow = window;
  })();`;

// Re-inject on every navigation so single-question next/previous keeps the UI.
await page.addInitScript({ content: `${prelude}\n${userscript}` });
if (targetUrl) {
  await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 });
} else {
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 45_000 });
}

await page.waitForSelector('#cx-exam-ai-drawer-ball', { timeout: 15_000 });
await page.dblclick('#cx-exam-ai-drawer-ball');

const summary = await page.evaluate(() => {
  const host = document.querySelector('#cx-exam-ai-drawer-host');
  const text = host?.shadowRoot?.textContent || '';
  return {
    url: location.href,
    title: document.title,
    questionLi: document.querySelectorAll('.questionLi').length,
    hasPreviewEntry: /整卷预览|试卷预览/.test(document.body?.innerText || ''),
    uiText: text.slice(0, 600),
  };
});

if (process.env.CX_SHOT) {
  await page.screenshot({ path: process.env.CX_SHOT, fullPage: false });
}

console.log(JSON.stringify(summary, null, 2));
if (process.env.CX_KEEP) {
  console.log('LIVE_SESSION_READY: keep this process alive for __cxGmHttp');
  setInterval(() => {}, 60_000);
} else {
  process.exit(0);
}
