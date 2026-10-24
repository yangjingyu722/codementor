import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@codementor/contracts': fileURLToPath(
        new URL('./packages/contracts/src/index.ts', import.meta.url),
      ),
      '@codementor/storage': fileURLToPath(
        new URL('./packages/storage/src/index.ts', import.meta.url),
      ),
      '@codementor/decision-engine': fileURLToPath(
        new URL('./packages/decision-engine/src/index.ts', import.meta.url),
      ),
      '@codementor/code-mapping': fileURLToPath(
        new URL('./packages/code-mapping/src/index.ts', import.meta.url),
      ),
    },
  },
  test: {
    include: ['packages/*/test/**/*.test.ts', 'apps/*/test/**/*.test.ts', 'tests/**/*.test.ts'],
    environment: 'node',
  },
});
