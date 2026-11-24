import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

const appRoot = import.meta.dirname;
const repoRoot = resolve(appRoot, '../..');

export default defineConfig({
  root: appRoot,
  base: '/settings/',
  plugins: [react()],
  resolve: {
    alias: [
      { find: '@cx/ui/styles.css', replacement: resolve(repoRoot, 'packages/ui/src/styles/workbench.css') },
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
