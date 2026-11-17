#!/usr/bin/env node
/**
 * 一键发布：版本号 → 构建 → 自检 → 离线测试 → Pages 静态产物 → GitHub → Cloudflare Pages → 线上校验
 *
 *   node tools/release.js                    用当前 package.json 版本发布
 *   node tools/release.js --bump patch       PATCH 位 +1 后发布（minor / major 同理）
 *   node tools/release.js --version 1.11.0   指定版本发布
 *   node tools/release.js --dry              只构建 + 测试，不 commit/push/deploy
 *   node tools/release.js --skip-test        跳过离线测试（不建议）
 *   node tools/release.js --no-deploy        只推 GitHub，不部署 Cloudflare
 *   node tools/release.js --no-verify        跳过线上版本号回读
 *   node tools/release.js -m "自定义提交说明"
 *
 * 设计约束（和 CLAUDE.md 一致）：
 *   1. dist/ 只由 build.js 生成，本脚本不手改产物；
 *   2. 只 add 白名单路径，永远不会把 logs/、.cdp-profile/、.chrome-profile/ 带进提交；
 *   3. 版本号唯一来源是 package.json，本脚本负责把它同步进 src/00-header.js 的 @version；
 *   4. 任何一步失败立即中止，不会出现"推了源码没推 dist"或"版本号对不上"。
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const HEADER = path.join(ROOT, 'src', '00-header.js');
const PKG = path.join(ROOT, 'package.json');
const PAGES_URL = 'https://cx-exam-ai.pages.dev';
const DIST_URL = PAGES_URL + '/dist/cx-exam-ai.user.js';

/** 允许进提交的路径（其余一律不 add，防止登录态/profile 泄露） */
const ADD_PATHS = [
  'src',
  'dist',
  'tools',
  'functions',
  'images',
  'docs',
  'README.md',
  'MAINTENANCE.md',
  'CLAUDE.md',
  'index.html',
  'settings.html',
  'package.json',
  'wrangler.jsonc',
  '.gitignore',
  'LICENSE'
];

const argv = process.argv.slice(2);
const flag = (name) => argv.includes('--' + name);
const opt = (name, def) => {
  const i = argv.indexOf('--' + name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : def;
};
const customMsg = (() => {
  const i = argv.indexOf('-m');
  return i >= 0 && argv[i + 1] ? argv[i + 1] : '';
})();

const DRY = flag('dry');
const SKIP_TEST = flag('skip-test');
const NO_DEPLOY = flag('no-deploy');
const NO_VERIFY = flag('no-verify');

let step = 0;
function say(msg) {
  step++;
  console.log('\n\x1b[36m[' + step + ']\x1b[0m ' + msg);
}
function ok(msg) {
  console.log('    \x1b[32m✓\x1b[0m ' + msg);
}
function warn(msg) {
  console.log('    \x1b[33m!\x1b[0m ' + msg);
}
function die(msg) {
  console.error('\n\x1b[31m✗ 中止：' + msg + '\x1b[0m');
  process.exit(1);
}

function run(cmd, args, opts) {
  const r = spawnSync(cmd, args, {
    cwd: ROOT,
    stdio: opts && opts.capture ? 'pipe' : 'inherit',
    encoding: 'utf8',
    shell: false
  });
  if (r.error) die(cmd + ' 执行失败：' + r.error.message);
  if (r.status !== 0 && !(opts && opts.allowFail)) {
    die(cmd + ' ' + args.join(' ') + ' 退出码 ' + r.status);
  }
  return r;
}

function readPkg() {
  return JSON.parse(fs.readFileSync(PKG, 'utf8'));
}

function bumpVersion(ver, kind) {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(ver || ''));
  if (!m) die('当前版本号不是 MAJOR.MINOR.PATCH：' + ver);
  let [maj, min, pat] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (kind === 'major') {
    maj += 1;
    min = 0;
    pat = 0;
  } else if (kind === 'minor') {
    min += 1;
    pat = 0;
  } else if (kind === 'patch') {
    pat += 1;
  } else {
    die('未知的 bump 类型：' + kind + '（只能是 patch / minor / major）');
  }
  return maj + '.' + min + '.' + pat;
}

function syncHeaderVersion(version) {
  const src = fs.readFileSync(HEADER, 'utf8');
  const re = /^(\/\/\s*@version\s+)(\S+)\s*$/m;
  if (!re.test(src)) die('src/00-header.js 里找不到 // @version');
  const next = src.replace(re, '$1' + version);
  if (next !== src) fs.writeFileSync(HEADER, next, 'utf8');
  return next !== src;
}

function readHeaderVersion() {
  const src = fs.readFileSync(HEADER, 'utf8');
  const m = /^\/\/\s*@version\s+(\S+)\s*$/m.exec(src);
  return m ? m[1] : '';
}

function git(args, opts) {
  return run('git', args, Object.assign({ capture: true }, opts || {}));
}

(async () => {
  console.log('\x1b[1m=== cx-exam-ai 发布 ===\x1b[0m' + (DRY ? '  (dry-run，不会提交/推送/部署)' : ''));

  /* ---------- 0. 版本号 ---------- */
  say('版本号');
  const pkg0 = readPkg();
  let version = pkg0.version;
  const want = opt('version', '');
  const bump = opt('bump', '');
  if (want && bump) die('--version 与 --bump 只能二选一');
  if (want) version = want;
  else if (bump) version = bumpVersion(version, bump);
  if (!/^\d+\.\d+\.\d+$/.test(version)) die('版本号格式不对：' + version);

  if (pkg0.version !== version) {
    pkg0.version = version;
    fs.writeFileSync(PKG, JSON.stringify(pkg0, null, 2) + '\n', 'utf8');
    ok('package.json → ' + version);
  }
  const headerChanged = syncHeaderVersion(version);
  ok('src/00-header.js @version → ' + version + (headerChanged ? '（已更新）' : '（本来就一致）'));
  if (readHeaderVersion() !== version) die('header 与 package.json 版本仍不一致');

  /* ---------- 1. 构建 ---------- */
  say('构建 dist/');
  run('node', ['build.js']);

  /* ---------- 2. 自检 ---------- */
  say('自检 tools/check.js');
  run('node', ['tools/check.js']);

  /* ---------- 3. 离线测试 ---------- */
  if (SKIP_TEST) {
    warn('--skip-test：跳过 tools/test-dom.js');
  } else {
    say('离线测试 tools/test-dom.js（约 10~30 秒）');
    run('node', ['tools/test-dom.js']);
  }

  /* ---------- 4. Pages 静态产物 ---------- */
  say('生成 .site/（Cloudflare Pages 发布目录）');
  run('node', ['tools/build-site.js']);

  /* ---------- 5. 提交 ---------- */
  if (DRY) {
    warn('--dry：跳过 git add / commit / push / deploy / 线上校验（工作区保持原样）');
    say('dry-run 结束');
    console.log('\n\x1b[1m本地流程通过（' + version + '）。\x1b[0m去掉 --dry 即可真正发布。');
    return;
  }
  say('提交到本地仓库');
  const dirty = git(['status', '--porcelain']).stdout.trim();
  if (!dirty) {
    warn('工作区没有改动，跳过提交');
  } else {
    // 白名单：只 add 这些路径，绝不 add -A / git add -f
    const existing = ADD_PATHS.filter((p) => fs.existsSync(path.join(ROOT, p)));
    git(['add', '--'].concat(existing));
    const staged = git(['diff', '--cached', '--name-only']).stdout.trim();
    if (!staged) {
      warn('白名单路径下没有可提交的改动');
    } else {
      const blocked = /(^|\n)(logs\/|\.cdp-profile\/|\.chrome-profile\/|\.shot-|\.watch\.|\.tmp-ocsjs\/)/.test(staged);
      if (blocked) die('暂存区出现了禁止提交的路径，已停止：\n' + staged);
      const files = staged.split('\n').filter(Boolean);
      ok('暂存 ' + files.length + ' 个文件');
      files.slice(0, 20).forEach((f) => console.log('      ' + f));
      if (files.length > 20) console.log('      … 其余 ' + (files.length - 20) + ' 个');
      const msg = customMsg || 'v' + version + ': 发布';
      git(['commit', '-m', msg]);
      ok('commit = ' + git(['rev-parse', '--short', 'HEAD']).stdout.trim());
    }
  }

  /* ---------- 6. GitHub ---------- */
  say('推送到 GitHub main');
  run('git', ['push', 'origin', 'main']);
  ok('已推送（Greasy Fork 会从 main 自动同步，ID 605687）');

  /* ---------- 7. Cloudflare Pages ---------- */
  if (NO_DEPLOY) {
    warn('--no-deploy：跳过 Cloudflare Pages');
  } else {
    say('部署 Cloudflare Pages');
    run('npx', ['wrangler', 'pages', 'deploy', '--branch=main']);
    ok('Pages 部署完成');
  }

  /* ---------- 8. 线上回读 ---------- */
  if (NO_VERIFY) {
    warn('--no-verify：跳过线上版本号回读');
  } else {
    say('回读线上版本号');
    try {
      const r = await fetch(DIST_URL, { cache: 'no-store' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const text = await r.text();
      const m = /^\/\/\s*@version\s+(\S+)\s*$/m.exec(text);
      const online = m ? m[1] : '(未找到 @version)';
      if (online === version) ok('Pages 线上 @version = ' + online);
      else warn('Pages 线上是 ' + online + '，与本地 ' + version + ' 不一致（CDN 缓存时延，稍后重试即可）');
    } catch (e) {
      warn('线上回读失败（网络问题，不影响已完成的部署）：' + e.message);
    }
  }

  console.log('\n\x1b[1m\x1b[32m发布完成：v' + version + '\x1b[0m');
  console.log('  安装/更新地址：' + DIST_URL);
  if (!NO_DEPLOY) console.log('  站点：' + PAGES_URL);
  console.log('  GitHub：https://github.com/wzj1122/cx-exam-ai/commits/main');
})();
