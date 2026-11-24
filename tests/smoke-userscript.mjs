import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

const root = resolve(import.meta.dirname, '..');
const fixtureDir = resolve(root, 'tests/fixtures');
const userscript = await readFile(resolve(root, 'apps/userscript/dist/cx-exam-ai.user.js'), 'utf8');

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    if (url.pathname === '/favicon.ico') {
      res.writeHead(204);
      res.end();
      return;
    }
    if (url.pathname === '/v1/chat/completions' && req.method === 'POST') {
      let body = '';
      for await (const chunk of req) body += chunk;
      const batch = body.includes('"questions"');
      const content = batch
        ? '{"answers":[{"id":"1234567","optionIds":["O2"],"confidence":0.92,"reason":"mock batch"}]}'
        : '{"optionIds":["O2"],"confidence":0.92,"reason":"mock single"}';
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content } }] }));
      return;
    }
    const file = resolve(fixtureDir, url.pathname.replace(/^\/+/, ''));
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end('not found');
  }
});
await new Promise((resolveReady) => server.listen(8811, '127.0.0.1', resolveReady));

const browser = await chromium.launch({
  executablePath: '/usr/bin/google-chrome',
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  await page.addInitScript(() => {
    const store = new Map();
    store.set('cx-exam-ai:v2:config', {
      version: 2,
      providers: [
        {
          id: 'mock',
          label: 'Mock',
          baseURL: 'http://127.0.0.1:8811/v1',
          apiKey: 'sk-mock',
          model: 'mock',
          apiStyle: 'openai',
          role: 'fast',
          weight: 1,
          temperature: 0.1,
        },
      ],
      ui: { autoEnterPreview: false, riskDefaultExcluded: true, theme: 'auto', showServerKey: true },
    });
    window.GM_getValue = (key, fallback) => (store.has(key) ? store.get(key) : fallback);
    window.GM_setValue = (key, value) => store.set(key, value);
    window.GM_deleteValue = (key) => store.delete(key);
    window.GM_xmlhttpRequest = (options) => {
      fetch(options.url, {
        method: options.method,
        headers: options.headers,
        body: options.data,
      })
        .then(async (response) => {
          options.onload?.({ status: response.status, responseText: await response.text() });
        })
        .catch((error) => options.onerror?.(error));
    };
    window.unsafeWindow = window;
  });
  await page.goto('http://127.0.0.1:8811/exam-random-options.html', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => {
    window.__cxClicks = 0;
    document.querySelectorAll('.answerBg').forEach((row) => {
      row.addEventListener('click', () => {
        window.__cxClicks++;
        const input = document.querySelector('#answer1234567');
        const key = row.querySelector('.num_option')?.getAttribute('data') || '';
        if (input) input.value = key;
        document.querySelectorAll('.check_answer').forEach((el) => el.classList.remove('check_answer'));
        row.querySelector('.answer_p')?.classList.add('check_answer');
      });
    });
  });
  await page.addScriptTag({ content: userscript });
  await page.waitForSelector('#cx-exam-ai-drawer-ball', { timeout: 8000 });
  await page.dblclick('#cx-exam-ai-drawer-ball');
  await page.waitForFunction(() => {
    const host = document.querySelector('#cx-exam-ai-drawer-host');
    return !!host?.shadowRoot?.textContent?.includes('随机选项模拟考试');
  }, { timeout: 8000 });
  await page.waitForFunction(() => {
    const text = document.querySelector('#cx-exam-ai-drawer-host')?.shadowRoot?.textContent || '';
    return text.includes('可填') || text.includes('风险') || text.includes('已校验');
  }, { timeout: 8000 });
  if (process.env.CX_SHOT) await page.screenshot({ path: process.env.CX_SHOT, fullPage: false });
  await page.getByRole('button', { name: '一键填写' }).click();
  await page.getByRole('button', { name: '确认填写' }).click();
  await page.waitForFunction(() => {
    return document.querySelector('#answer1234567')?.value === 'A';
  }, { timeout: 8000 });
  const text = await page.evaluate(() => document.querySelector('#cx-exam-ai-drawer-host')?.shadowRoot?.textContent || '');
  const clicks = await page.evaluate(() => window.__cxClicks);
  const ballNumber = await page.evaluate(() => document.querySelector('#cx-exam-ai-drawer-ball .cx-ball-num')?.textContent);
  const checks = {
    title: text.includes('随机选项模拟考试'),
    optionText: text.includes('SYN + ACK'),
    serverKey: text.includes('键 A'),
    fillButton: text.includes('一键填写'),
    riskBadge: text.includes('风险') || text.includes('可填'),
    ballNumber: ballNumber === '1',
    filledServerKey: (await page.evaluate(() => document.querySelector('#answer1234567')?.value)) === 'A',
    clickedOnce: clicks === 1,
  };
  console.log(JSON.stringify({ checks, errors }, null, 2));
  if (!Object.values(checks).every(Boolean)) process.exitCode = 1;
  if (errors.length) process.exitCode = 1;
} finally {
  await browser.close();
  server.close();
}
