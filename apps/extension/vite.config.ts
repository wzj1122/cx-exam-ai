import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { crx } from '@crxjs/vite-plugin';
import { resolve } from 'node:path';
import manifest from './manifest.json';

const root = resolve(import.meta.dirname, '../..');

export default defineConfig({
  root: import.meta.dirname,
  plugins: [react(), crx({ manifest })],
  resolve: {
    alias: [
      {
        find: '@cx/ui/styles.css?inline',
        replacement: `${resolve(root, 'packages/ui/src/styles/workbench.css')}?inline`,
      },
      { find: '@cx/ui/styles.css', replacement: resolve(root, 'packages/ui/src/styles/workbench.css') },
      { find: '@cx/ui/state/', replacement: resolve(root, 'packages/ui/src/state/') },
      { find: '@cx/ui/components/', replacement: resolve(root, 'packages/ui/src/components/') },
      { find: '@cx/core', replacement: resolve(root, 'packages/core/src/index.ts') },
      { find: '@cx/chaoxing', replacement: resolve(root, 'packages/chaoxing/src/index.ts') },
      { find: '@cx/ui', replacement: resolve(root, 'packages/ui/src/index.ts') },
    ],
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
