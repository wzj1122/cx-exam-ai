import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@cx/core': `${root}/packages/core/src/index.ts`,
      '@cx/chaoxing': `${root}/packages/chaoxing/src/index.ts`,
      '@cx/ui': `${root}/packages/ui/src/index.ts`,
    },
  },
  test: {
    environment: 'jsdom',
    include: ['tests/unit/**/*.test.ts'],
    restoreMocks: true,
    clearMocks: true,
  },
});
