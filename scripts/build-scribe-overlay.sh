#!/usr/bin/env bash
# Compile the Scribe system-wide overlay helper (AX read + measure + transparent squiggle window).
# Output lands next to the source so dev mode finds it; electron-builder / CI copies it into the
# packaged app's resources/bin. Pins the deployment target so the binary launches on older macOS
# (same minos discipline as the bundled engine — a newer SDK's minos silently refuses to launch).
#
# Runs automatically before `npm run dev` (predev hook). To keep that fast + never block the app:
#   - no-op off macOS or when swiftc is missing (feature just degrades to hotkey-less/no-overlay),
#   - skip when the binary is already newer than the source (incremental),
#   - non-fatal: a compile error prints a warning but does not fail `npm run dev`.
# Pass --force to always rebuild.
set -uo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$ROOT_DIR/scribe-overlay/main.swift"
OUT="$ROOT_DIR/scribe-overlay/scribe-overlay"

# macOS + swiftc only.
if [[ "$(uname)" != "Darwin" ]] || ! command -v swiftc >/dev/null 2>&1; then
  echo "[scribe-overlay] skip (needs macOS + swiftc)"; exit 0
fi

# Incremental: skip if the binary is already up to date (unless --force).
if [[ "${1:-}" != "--force" && -f "$OUT" && "$OUT" -nt "$SRC" ]]; then
  echo "[scribe-overlay] up to date"; exit 0
fi

if swiftc -O -target arm64-apple-macos13.0 -emit-executable "$SRC" -o "$OUT" \
     -framework Cocoa -framework ApplicationServices; then
  chmod +x "$OUT"
  echo "built $OUT"
  # minos gate: log the deployment floor so a too-new SDK is caught in review.
  otool -l "$OUT" | awk '/LC_BUILD_VERSION/{f=1} f&&/minos/{print "[scribe-overlay] minos="$2; exit}'
else
  echo "[scribe-overlay] WARNING: build failed — overlay will use the previous binary (or be absent)" >&2
fi
exit 0
