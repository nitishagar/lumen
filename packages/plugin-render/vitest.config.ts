import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: '@lumen-seo/plugin-render',
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
