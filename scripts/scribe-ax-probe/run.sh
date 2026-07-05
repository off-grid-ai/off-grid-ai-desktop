#!/usr/bin/env bash
# Build + run the Scribe AX probe. It reads (never changes) the focused text field in the
# frontmost app and reports whether macOS gives us per-word bounding rects — the make-or-
# break for painting inline squiggles over other apps.
#
# Usage:  bash scripts/scribe-ax-probe/run.sh
# Then click into the app + text field you want to test (Notes, Mail, Slack, Chrome/Gmail).
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
bin="/tmp/scribe-ax-probe"

echo "[probe] building…"
swiftc -O "$here/main.swift" -o "$bin" -framework Cocoa -framework ApplicationServices

echo "[probe] running (grant Accessibility to your terminal if prompted)…"
"$bin"
