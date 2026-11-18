import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['server/integration/*.test.ts'],
    fileParallelism: false,
    // Scenarios share the matchmaker pool: run them one at a time.
    sequence: { concurrent: false },
  },
});
