import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';

const root = resolve(import.meta.dirname, '..');
const fixtureDir = resolve(root, 'tests/fixtures');
const extension = resolve(root, 'apps/extension/dist');

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
await new Promise((resolveReady) => server.listen(8812, '127.0.0.1', resolveReady));

const context = await chromium.launchPersistentContext(`/tmp/cx-ext-smoke-${Date.now()}`, {
  headless: false,
  ignoreDefaultArgs: ['--disable-extensions'],
  viewport: { width: 1280, height: 900 },
  args: [
    `--disable-extensions-except=${extension}`,
    `--load-extension=${extension}`,
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--disable-gpu',
    '--window-position=-2400,-2400',
    '--window-size=1280,900',
  ],
});

try {
  const workers = await waitForWorkers(context);
  const extensionId = workers[0] ? new URL(workers[0]).host : extensionIdFromPath(extension);

  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/src/options/index.html`);
  await options.waitForSelector('.cxai-settings', { timeout: 8000 });
  await options.evaluate(() =>
    chrome.storage.local.set({
      'cx-exam-ai:v2:config': {
        version: 2,
        providers: [
          {
            id: 'mock',
            label: 'Mock',
            baseURL: 'http://127.0.0.1:8812/v1',
            apiKey: 'sk-mock',
            model: 'mock',
            apiStyle: 'openai',
            role: 'fast',
            weight: 1,
            temperature: 0.1,
          },
        ],
        ui: { autoEnterPreview: false, riskDefaultExcluded: true, theme: 'auto', showServerKey: true },
      },
    }),
  );

  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  page.on('console', (message) => console.log('PAGE', message.type(), message.text()));
  context.on('serviceworker', (worker) => console.log('SW', worker.url()));
  await page.goto('http://127.0.0.1:8812/exam-random-options.html', { waitUntil: 'domcontentloaded' });
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
  await page.waitForSelector('#cx-exam-ai-ball', { timeout: 10_000 });
  const ball = await page.locator('#cx-exam-ai-ball').innerText();
  await page.dblclick('#cx-exam-ai-ball');
  await page.waitForFunction(() => {
    const host = document.querySelector('#cx-exam-ai-card-host');
    const text = host?.shadowRoot?.textContent || '';
    return text.includes('可填') || text.includes('风险') || text.includes('已校验');
  }, { timeout: 10_000 });
  await page.getByRole('button', { name: '一键填写' }).click();
  await page.getByRole('button', { name: '确认填写' }).click();
  await page.waitForFunction(() => document.querySelector('#answer1234567')?.value === 'A', { timeout: 8000 });
  const cardText = await page.evaluate(
    () => document.querySelector('#cx-exam-ai-card-host')?.shadowRoot?.textContent || '',
  );
  const clicks = await page.evaluate(() => window.__cxClicks);

  const optionsText = await options.locator('body').innerText();

  const checks = {
    ball: ball.includes('CX'),
    contentLoaded: page.url().includes('/exam-random-options.html'),
    card: cardText.includes('随机选项模拟考试') || cardText.includes('CX 考试 AI'),
    cardVisible: await page.evaluate(() => document.querySelector('#cx-exam-ai-card-host')?.style.display === 'block'),
    options: optionsText.includes('模型') && optionsText.includes('同步'),
    filledServerKey: (await page.evaluate(() => document.querySelector('#answer1234567')?.value)) === 'A',
    clickedOnce: clicks === 1,
  };
  console.log(JSON.stringify({ checks, workers, errors }, null, 2));
  if (!Object.values(checks).every(Boolean)) process.exitCode = 1;
  if (errors.length) process.exitCode = 1;
} finally {
  await context.close();
  server.close();
}

async function waitForWorkers(context) {
  for (let i = 0; i < 20; i++) {
    const workers = context.serviceWorkers().map((worker) => worker.url());
    if (workers.length) return workers;
    await new Promise((resolveReady) => setTimeout(resolveReady, 250));
  }
  return [];
}

function extensionIdFromPath(path) {
  const hex = createHash('sha256').update(path).digest('hex').slice(0, 32);
  return Array.from(hex)
    .map((char) => String.fromCharCode(97 + parseInt(char, 16)))
    .join('');
}
