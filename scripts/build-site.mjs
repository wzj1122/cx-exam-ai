import { cp, mkdir, rm, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const out = resolve(root, '.site');
const site = resolve(root, 'site');
const userscript = resolve(root, 'apps/userscript/dist/cx-exam-ai.user.js');
const webSettings = resolve(root, 'apps/web-settings/dist');
const extensionZip = resolve(root, 'release/cx-exam-ai-extension-v2.0.1.zip');

await rm(out, { recursive: true, force: true });
await mkdir(resolve(out, 'dist'), { recursive: true });
await cp(site, out, { recursive: true });
await cp(webSettings, resolve(out, 'settings'), { recursive: true });

if (!existsSync(userscript)) {
  console.error('缺少 apps/userscript/dist/cx-exam-ai.user.js，请先 npm run build:userscript');
  process.exit(1);
}
await cp(userscript, resolve(out, 'dist/cx-exam-ai.user.js'));
if (existsSync(extensionZip)) {
  await cp(extensionZip, resolve(out, 'dist/cx-exam-ai-extension-v2.0.1.zip'));
}

const info = await stat(resolve(out, 'dist/cx-exam-ai.user.js'));
console.log(`.site ready: ${out}`);
console.log(`userscript: ${(info.size / 1024).toFixed(1)} KB`);
