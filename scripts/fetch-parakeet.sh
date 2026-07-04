#!/usr/bin/env bash
# Stage the Parakeet STT runtime into resources/bin/parakeet so extraResources bundles
# it at Contents/Resources/bin. Mirrors how whisper/ffmpeg/dylibs ship — a self-contained
# engine, no Python. Two pieces:
#   1. sherpa-onnx-offline  — the C++ ONNX-runtime CLI (offline transducer)
#   2. a Parakeet ONNX model (encoder/decoder/joiner + tokens) under model/
#
# Runtime resolves these via parakeet-cli.ts (parakeetBin / parakeetModel). If this step
# is skipped or fails, transcription simply falls back to whisper — Parakeet is additive,
# so a missing runtime can never break a release.
#
# Pin exact versions/URLs via env so CI is reproducible. Left unpinned here on purpose:
# fill SHERPA_ONNX_URL + PARAKEET_MODEL_URL in the workflow (or a secrets/vars entry)
# once the exact sherpa-onnx release + Parakeet ONNX export are chosen.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST="$ROOT_DIR/resources/bin/parakeet"
MODEL_DIR="$DEST/model"
mkdir -p "$MODEL_DIR"

: "${SHERPA_ONNX_URL:=}"      # tarball/zip containing sherpa-onnx-offline for macOS arm64
: "${PARAKEET_MODEL_URL:=}"   # tarball containing encoder.onnx/decoder.onnx/joiner.onnx/tokens.txt

if [[ -z "$SHERPA_ONNX_URL" || -z "$PARAKEET_MODEL_URL" ]]; then
  echo "[parakeet] SHERPA_ONNX_URL / PARAKEET_MODEL_URL not set — skipping (whisper stays the engine)."
  exit 0
fi

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

echo "[parakeet] downloading runtime…"
curl -fsSL "$SHERPA_ONNX_URL" -o "$work/sherpa.tgz"
tar -xzf "$work/sherpa.tgz" -C "$work"
# Find the offline CLI wherever the archive nests it.
bin="$(find "$work" -type f -name 'sherpa-onnx-offline' | head -1)"
if [[ -z "$bin" ]]; then echo "[parakeet] sherpa-onnx-offline not found in archive" >&2; exit 1; fi
cp "$bin" "$DEST/sherpa-onnx-offline"
chmod +x "$DEST/sherpa-onnx-offline"

echo "[parakeet] downloading model…"
curl -fsSL "$PARAKEET_MODEL_URL" -o "$work/model.tgz"
tar -xzf "$work/model.tgz" -C "$work"
for f in encoder.onnx decoder.onnx joiner.onnx tokens.txt; do
  src="$(find "$work" -type f -name "$f" | head -1)"
  if [[ -z "$src" ]]; then echo "[parakeet] model file $f missing from archive" >&2; exit 1; fi
  cp "$src" "$MODEL_DIR/$f"
done

# Gate: any /opt/homebrew or /usr/local dep won't exist on a user's Mac (same rule as the
# llama engine). Fail loudly rather than ship a binary that can't launch.
if otool -L "$DEST/sherpa-onnx-offline" | grep -qE '/opt/homebrew|/usr/local'; then
  echo "[parakeet] foreign dylib dependency detected — not shippable" >&2
  otool -L "$DEST/sherpa-onnx-offline" >&2
  exit 1
fi

echo "[parakeet] staged:"
ls -la "$DEST" "$MODEL_DIR"
