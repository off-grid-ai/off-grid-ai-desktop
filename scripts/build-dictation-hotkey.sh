#!/usr/bin/env bash
# Compile the dictation hotkey helper (CGEventTap key down/up for push-to-talk).
# Output lands next to the source so dev mode finds it, and electron-builder copies
# it into the packaged app's resources/bin (Pro build config).
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$ROOT_DIR/dictation-hotkey/main.swift"
OUT="$ROOT_DIR/dictation-hotkey/dictation-hotkey"
swiftc -O -target arm64-apple-macos13.0 -emit-executable "$SRC" -o "$OUT"
echo "built $OUT"
