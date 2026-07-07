import { defineConfig } from 'vitest/config';

// Unit + component-integration tests (fast, deterministic). The Playwright Electron E2E lives
// in e2e/ and runs via `npm run test:e2e`, NOT here.
//
// Most tests are pure/node. Component integration tests that mount React and drive real DOM
// events (name them `*.dom.test.tsx`) run under jsdom via environmentMatchGlobs, so the fast
// node suite isn't slowed by a DOM for every file.
export default defineConfig({
  test: {
    include: ['src/**/*.test.{ts,tsx}', 'pro/**/*.test.{ts,tsx}'],
    exclude: ['e2e/**', 'node_modules/**', 'out/**'],
    environmentMatchGlobs: [['**/*.dom.test.tsx', 'jsdom']],
  },
});
