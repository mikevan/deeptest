import { defineConfig } from 'vitest/config';

// DeepTest's own tests. Run with `npm test`; DeepTest measures itself with
// exactly this config plus the attribution hook.
export default defineConfig({
  test: {
    include: ['test/*.test.ts'],
    testTimeout: 120_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
});
