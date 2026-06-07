import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/unit/**/*.test.ts'],
    environment: 'node',
    globals: false,
    reporters: 'default',
    environmentMatchGlobs: [
      ['test/unit/Html.golden.test.ts', 'jsdom'],
      ['test/unit/DiffHtml.golden.test.ts', 'jsdom'],
    ],
  },
});
