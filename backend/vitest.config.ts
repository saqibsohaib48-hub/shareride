import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgres://shareride:shareride@localhost:5432/shareride_test',
      JWT_SECRET: 'test-secret-test-secret-test-secret-test-secret',
      DATA_ENCRYPTION_KEY: 'a3f1c2d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90',
      MAP_PROVIDER: 'mock',
      PAYMENT_PROVIDER: 'mock',
      MOCK_WEBHOOK_SECRET: 'test-webhook-secret',
    },
    globalSetup: './test/globalSetup.ts',
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 60000,
  },
});
