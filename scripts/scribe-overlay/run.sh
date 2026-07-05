#!/usr/bin/env bash
# Build + run the Scribe overlay Phase 1 checkpoint. Draws red wavy underlines under a demo set
# of misspelled words in the focused NATIVE text field (Notes/Mail/TextEdit), tracking as you
# type/scroll. Proves the overlay window + coordinate transform before the engine is wired in.
#
# Usage:  bash scripts/scribe-overlay/run.sh [word1 word2 ...]
# Then open Notes and type:  please recieve teh alot of wierd notes
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
bin="/tmp/scribe-overlay"
echo "[overlay] building…"
swiftc -O "$here/main.swift" -o "$bin" -framework Cocoa -framework ApplicationServices
echo "[overlay] running (Ctrl-C to quit)…"
"$bin" "$@"
