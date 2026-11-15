#!/usr/bin/env node
/**
 * 生成纯静态发布目录 .site/，只给 Cloudflare Pages / Workers 静态资源用。
 *
 * 为什么要有这一步：直接把仓库根目录当站点目录，云厂商会把 logs/、.cdp-profile/、
 * .chrome-profile/ 这些本地产物一起传上去（本地执行 wrangler deploy 时尤其危险，
 * 浏览器 profile 里是登录态 Cookie）。这里只拷贝三个该公开的东西：
 *   index.html  →  /index.html
 *   dist/       →  /dist/            （一键安装的 .user.js）
 *   images/     →  /images/          （收款码）
 *
 *   node tools/build-site.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, '.site');
const FILES = ['index.html'];
const DIRS = ['dist', 'images'];

function walk(dir) {
  let n = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) n += walk(p);
    else n += 1;
  }
  return n;
}

exportSite();

function exportSite() {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });

  for (const f of FILES) {
    const src = path.join(ROOT, f);
    if (!fs.existsSync(src)) throw new Error(`缺少 ${f}`);
    fs.copyFileSync(src, path.join(OUT, f));
  }
  for (const d of DIRS) {
    const src = path.join(ROOT, d);
    if (!fs.existsSync(src)) throw new Error(`缺少 ${d}/`);
    fs.cpSync(src, path.join(OUT, d), { recursive: true });
  }

  const n = walk(OUT);
  let bytes = 0;
  for (const e of fs.readdirSync(OUT, { recursive: true, withFileTypes: true })) {
    if (e.isFile()) bytes += fs.statSync(path.join(e.parentPath || e.path, e.name)).size;
  }
  console.log(`[site] .site/ <- index.html + dist/ + images/（${n} 个文件，${(bytes / 1024).toFixed(1)} KB）`);
}
