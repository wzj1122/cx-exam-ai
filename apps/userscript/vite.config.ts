import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import monkey from 'vite-plugin-monkey';
import { resolve } from 'node:path';

const appRoot = import.meta.dirname;
const repoRoot = resolve(appRoot, '../..');

export default defineConfig({
  root: appRoot,
  plugins: [
    react(),
    monkey({
      entry: 'src/main.tsx',
      userscript: {
        name: 'CX 考试 AI 大脑 · 学习通考试自动答题',
        namespace: 'https://github.com/wzj1122/cx-exam-ai',
        version: '2.0.0',
        description: '考试专用 AI 答题助手：答案表复核、半自动填写、随机选项防点错。',
        author: 'wzj1122',
        license: 'MIT',
        homepage: 'https://github.com/wzj1122/cx-exam-ai',
        supportURL: 'https://github.com/wzj1122/cx-exam-ai/issues',
        updateURL:
          'https://update.greasyfork.org/scripts/605687/CX%20%E8%80%83%E8%AF%95%20AI%20%E5%A4%A7%E8%84%91%20%C2%B7%20%E5%AD%A6%E4%B9%A0%E9%80%9A%E8%80%83%E8%AF%95%E8%87%AA%E5%8A%A8%E7%AD%94%E9%A2%98.user.js',
        downloadURL:
          'https://update.greasyfork.org/scripts/605687/CX%20%E8%80%83%E8%AF%95%20AI%20%E5%A4%A7%E8%84%91%20%C2%B7%20%E5%AD%A6%E4%B9%A0%E9%80%9A%E8%80%83%E8%AF%95%E8%87%AA%E5%8A%A8%E7%AD%94%E9%A2%98.user.js',
        match: [
          '*://*.chaoxing.com/*',
          '*://*.edu.cn/*',
          'https://cx-exam-ai-app.pages.dev/*',
          'http://127.0.0.1/*',
        ],
        grant: [
          'GM_xmlhttpRequest',
          'GM_getValue',
          'GM_setValue',
          'GM_deleteValue',
          'unsafeWindow',
        ],
        connect: ['*'],
        'run-at': 'document-idle',
      },
      build: {
        fileName: 'cx-exam-ai.user.js',
        autoGrant: false,
      },
    }),
  ],
  resolve: {
    alias: [
      {
        find: '@cx/ui/styles.css?inline',
        replacement: `${resolve(repoRoot, 'packages/ui/src/styles/workbench.css')}?inline`,
      },
      { find: '@cx/ui/styles.css', replacement: resolve(repoRoot, 'packages/ui/src/styles/workbench.css') },
      { find: '@cx/ui/state/', replacement: resolve(repoRoot, 'packages/ui/src/state/') },
      { find: '@cx/ui/components/', replacement: resolve(repoRoot, 'packages/ui/src/components/') },
      { find: '@cx/core', replacement: resolve(repoRoot, 'packages/core/src/index.ts') },
      { find: '@cx/chaoxing', replacement: resolve(repoRoot, 'packages/chaoxing/src/index.ts') },
      { find: '@cx/ui', replacement: resolve(repoRoot, 'packages/ui/src/index.ts') },
    ],
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
