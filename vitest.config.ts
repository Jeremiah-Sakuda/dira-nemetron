import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'packages/**/*.test.ts',
      'tests/**/*.test.ts',
      'apps/web/tests/**/*.test.ts',
    ],
    testTimeout: 30_000,
    // Property tests and the 20x replay loop can be CPU heavy; keep workers bounded.
    pool: 'threads',
  },
});
