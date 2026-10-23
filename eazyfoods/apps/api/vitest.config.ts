import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgresql://postgres:pw@localhost:5432/eazyfoods_test',
    },
    globalSetup: ['test/global-setup.ts'],
    fileParallelism: false,
    testTimeout: 20000,
  },
});
