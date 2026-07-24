import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: { reporter: ['text', 'html'] },
    environment: 'node',
    fileParallelism: false,
    testTimeout: 15_000,
  },
});
