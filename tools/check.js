#!/usr/bin/env node
/**
 * 静态自检：语法 + 模块契约。
 * 不引入任何依赖，只用 node:vm 编译一次，确认 8 个模块拼起来能过解析器。
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const DIST = path.join(ROOT, 'dist', 'cx-exam-ai.user.js');

let bad = 0;
const files = fs.readdirSync(SRC).filter((f) => f.endsWith('.js')).sort();

if (!files.length) {
  console.error('src/ 下没有 js 文件');
  process.exit(1);
}

// 1) 单文件语法
for (const f of files) {
  const file = path.join(SRC, f);
  const code = fs.readFileSync(file, 'utf8');
  try {
    new vm.Script(code, { filename: file });
  } catch (e) {
    bad++;
    console.error(`✗ 语法错误 ${f}: ${e.message}`);
    continue;
  }
  if (/^\s*$/.test(code)) {
    bad++;
    console.error(`✗ 空文件 ${f}`);
  }
}

// 2) 命名空间契约：模块必须挂到 CXAI.* 或使用 CXAI.*
const EXPECT = {
  '01-core.js': ['CXAI.U =', 'CXAI.Store =', 'CXAI.Cfg =', 'CXAI.Log =', 'CXAI.DEFAULT_CONFIG', 'CXAI.PRESETS'],
  '02-font.js': ['CXAI.Font'],
  '03-scraper.js': ['CXAI.Scraper'],
  '03b-vision.js': ['CXAI.Vision'],
  '04-ai.js': ['CXAI.AI'],
  '05-apply.js': ['CXAI.Apply'],
  '06-guard.js': ['CXAI.Guard'],
  '07-ui.js': ['CXAI.UI'],
  '08-main.js': ['CXAI.Engine']
};

for (const [f, needles] of Object.entries(EXPECT)) {
  if (!files.includes(f)) {
    bad++;
    console.error(`✗ 缺少模块 ${f}`);
    continue;
  }
  const code = fs.readFileSync(path.join(SRC, f), 'utf8');
  for (const n of needles) {
    if (!code.includes(n)) {
      bad++;
      console.error(`✗ ${f} 未导出 ${n}`);
    }
  }
}

// 3) 模块依赖顺序：引用方必须在定义方之后
const ORDER = files.map((f) => f.slice(0, 2));
if (ORDER.join(',') !== ORDER.slice().sort().join(',')) {
  bad++;
  console.error('✗ 文件编号顺序异常：' + files.join(' '));
}

// 4) 构建产物一致性
if (fs.existsSync(DIST)) {
  const dist = fs.readFileSync(DIST, 'utf8');
  const totalSrc = files.reduce((s, f) => s + fs.readFileSync(path.join(SRC, f), 'utf8').length, 0);
  if (dist.length < totalSrc * 0.9) {
    bad++;
    console.error('✗ dist 产物比源码还短，可能构建失败');
  }
  if (/\/\* ={20} 08-main\.js/.test(dist) === false) {
    bad++;
    console.error('✗ dist 未包含 08-main.js，请重新构建');
  }
} else {
  console.warn('· dist 尚未构建（先跑 node build.js）');
}

if (bad) {
  console.error(`\n自检失败：${bad} 个问题`);
  process.exit(1);
}
console.log(`✓ 自检通过：${files.length} 个模块，语法与契约正常`);
