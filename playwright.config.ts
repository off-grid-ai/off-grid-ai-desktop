import { defineConfig } from '@playwright/test'

// Electron E2E. We drive the real app via Playwright's Electron support and read
// the renderer DOM directly (no OCR needed — it's a Chromium page). Single worker:
// each spec launches its own Electron instance against a fresh userData dir.
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: 'list'
})
