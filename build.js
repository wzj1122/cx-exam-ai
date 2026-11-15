#!/usr/bin/env node
/**
 * 极简打包器：把 src/*.js 按文件名顺序拼接成一个 Tampermonkey 用户脚本。
 * 零依赖，不需要 npm install。
 *
 *   node build.js           生产构建
 *   node build.js --watch   监听变更自动重建
 */
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const SRC = path.join(ROOT, 'src');
const DIST = path.join(ROOT, 'dist');
const OUT = path.join(DIST, 'cx-exam-ai.user.js');

function build() {
  const files = fs
    .readdirSync(SRC)
    .filter((f) => f.endsWith('.js'))
    .sort();

  const headerFile = files.find((f) => f.startsWith('00-'));
  if (!headerFile) throw new Error('缺少 00-header.js');

  const header = fs.readFileSync(path.join(SRC, headerFile), 'utf8').trimEnd();
  const body = files
    .filter((f) => f !== headerFile)
    .map((f) => {
      const code = fs.readFileSync(path.join(SRC, f), 'utf8').trimEnd();
      return `/* ==================== ${f} ==================== */\n${code}`;
    })
    .join('\n\n');

  const out = `${header}
(function () {
'use strict';

/* 全局命名空间：所有模块挂载到 CXAI 上，模块之间只依赖它 */
var CXAI = {};
CXAI.__version = ${JSON.stringify(require('./package.json').version)};
CXAI.__builtAt = ${JSON.stringify(new Date().toISOString())};

${body}
})();
`;

  fs.mkdirSync(DIST, { recursive: true });
  fs.writeFileSync(OUT, out, 'utf8');
  const kb = (Buffer.byteLength(out) / 1024).toFixed(1);
  console.log(`[build] ${new Date().toLocaleTimeString()} -> dist/cx-exam-ai.user.js (${kb} KB, ${out.split('\n').length} 行)`);
}

build();

if (process.argv.includes('--watch')) {
  let timer = null;
  fs.watch(SRC, () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      try {
        build();
      } catch (e) {
        console.error('[build] 失败:', e.message);
      }
    }, 120);
  });
  console.log('[build] watching src/ ...');
}
