import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['__tests__/**/*.integration.test.ts'],
    testTimeout: 15000,  // allow time for the dev server to respond
  },
});
