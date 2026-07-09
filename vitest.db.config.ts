import { defineConfig } from 'vitest/config';

// Dedicated config for the DB integration tests (*.dbtest.ts). Kept separate from the
// default vitest run because they load the better-sqlite3 native module (see
// scripts/test-db.sh). Run via `npm run test:db`.
export default defineConfig({
  test: {
    include: ['src/main/__tests__/*.dbtest.ts'],
    exclude: ['node_modules/**', 'out/**', 'e2e/**'],
  },
});
