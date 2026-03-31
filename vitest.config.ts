import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    root: '.',
    include: ['**/*.{test,spec}.ts'],
    exclude: ['**/*.integration.test.ts', '**/node_modules/**'],
  },
});
