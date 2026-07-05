#!/usr/bin/env bash
# Compile the Scribe system-wide overlay helper (AX read + measure + transparent squiggle window).
# Output lands next to the source so dev mode finds it; electron-builder / CI copies it into the
# packaged app's resources/bin. Pins the deployment target so the binary launches on older macOS
# (same minos discipline as the bundled engine — a newer SDK's minos silently refuses to launch).
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$ROOT_DIR/scribe-overlay/main.swift"
OUT="$ROOT_DIR/scribe-overlay/scribe-overlay"
swiftc -O -target arm64-apple-macos13.0 -emit-executable "$SRC" -o "$OUT" \
  -framework Cocoa -framework ApplicationServices
chmod +x "$OUT"
echo "built $OUT"
# minos gate: log the deployment floor so a too-new SDK is caught in review.
otool -l "$OUT" | awk '/LC_BUILD_VERSION/{f=1} f&&/minos/{print "[scribe-overlay] minos="$2; exit}'
