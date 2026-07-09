#!/usr/bin/env bash
# DB integration tests (src/main/__tests__/*.dbtest.ts) exercise the real data layer against
# a temp SQLite DB. They need better-sqlite3-multiple-ciphers built for the TEST RUNNER's node
# ABI - but the app builds it for ELECTRON's ABI (via electron-builder install-app-deps). So:
# rebuild for node, run the tests, then ALWAYS restore Electron's build - even on failure or
# interrupt - so the Electron app is never left with a mismatched native module.
#
# Kept OUT of the default `npm test` (those files are *.dbtest.ts, not *.test.ts) precisely
# because of this ABI swap. Run it explicitly: `npm run test:db`. A CI job that runs it must
# do so in an isolated step (the rebuild mutates node_modules).
set -uo pipefail

restore() {
  echo "[test:db] restoring the Electron ABI build of better-sqlite3-multiple-ciphers..."
  npx electron-builder install-app-deps >/dev/null 2>&1 \
    || echo "[test:db] WARNING: restore failed - run 'npx electron-builder install-app-deps' before launching the app."
}
trap restore EXIT

echo "[test:db] rebuilding better-sqlite3-multiple-ciphers for node $(node -v)..."
npm rebuild better-sqlite3-multiple-ciphers >/dev/null 2>&1

echo "[test:db] running DB integration tests..."
npx vitest run "src/main/__tests__/database-integration.dbtest.ts" "src/main/__tests__/rag-store-integration.dbtest.ts" "$@"
