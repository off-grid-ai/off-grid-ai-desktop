import { defineConfig } from 'vitest/config';

// Unit tests only (fast, deterministic). The Playwright Electron E2E lives in
// e2e/ and runs via `npm run test:e2e`, NOT here.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    exclude: ['e2e/**', 'node_modules/**', 'out/**'],
  },
});
