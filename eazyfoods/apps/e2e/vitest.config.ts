import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { globalSetup: ['./global-setup.ts'], testTimeout: 90_000, hookTimeout: 120_000, fileParallelism: false, include: ['tests/**/*.test.ts'] },
});
