import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

// Dedicated config for core + Pro DB integration tests (*.dbtest.ts). Kept separate from the
// default vitest run because they load the better-sqlite3 native module (see
// scripts/test-db.sh). Run via `npm run test:db`.
export default defineConfig({
  resolve: {
    alias: {
      '@offgrid/core': resolve(__dirname, 'src'),
      '@offgrid/pro': resolve(__dirname, 'pro'),
      '@renderer': resolve(__dirname, 'src/renderer/src'),
      '@': resolve(__dirname, 'src/renderer/src')
    }
  },
  test: {
    include: [
      'integration-tests/*.dbtest.ts',
      'src/main/__tests__/*.dbtest.ts',
      'pro/main/__tests__/*.dbtest.ts'
    ],
    exclude: ['node_modules/**', 'out/**', 'e2e/**']
  }
})
