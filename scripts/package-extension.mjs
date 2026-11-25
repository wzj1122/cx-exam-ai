import { execFileSync } from 'node:child_process';
import { mkdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const dist = resolve(root, 'apps/extension/dist');
const release = resolve(root, 'release');
const zip = resolve(release, 'cx-exam-ai-extension-v2.0.1.zip');

await mkdir(release, { recursive: true });
await rm(zip, { force: true });
execFileSync('zip', ['-qr', zip, '.'], { cwd: dist, stdio: 'inherit' });
console.log(`extension zip: ${zip}`);
