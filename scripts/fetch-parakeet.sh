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

: "${SHERPA_ONNX_URL:=}"      # tarball/zip containing sherpa-onnx-offline for macOS arm64
: "${PARAKEET_MODEL_URL:=}"   # tarball containing encoder.onnx/decoder.onnx/joiner.onnx/tokens.txt

if [[ -z "$SHERPA_ONNX_URL" || -z "$PARAKEET_MODEL_URL" ]]; then
  echo "[parakeet] SHERPA_ONNX_URL / PARAKEET_MODEL_URL not set — skipping (whisper stays the engine)."
  exit 0
fi

# Only create the staging dirs once we're actually going to fill them (avoid leaving an
# empty resources/bin/parakeet/model on the skip path).
mkdir -p "$MODEL_DIR"

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

echo "[parakeet] downloading runtime…"
curl -fsSL "$SHERPA_ONNX_URL" -o "$work/sherpa.tgz"
tar -xzf "$work/sherpa.tgz" -C "$work"
# Find the offline CLI, then take the bin/ + lib/ pair around it. We PRESERVE the
# prebuilt's own bin/lib structure (dylibs live in ../lib, which is what the binary's
# @rpath expects) rather than flatten — flattening would break @rpath. No symlinks are
# copied as symlinks: cp -RL follows them into real files (none inside a signed .app).
bin="$(find "$work" -type f -name 'sherpa-onnx-offline' | head -1)"
if [[ -z "$bin" ]]; then echo "[parakeet] sherpa-onnx-offline not found in archive" >&2; exit 1; fi
root="$(dirname "$(dirname "$bin")")" # dir containing bin/ and lib/
rm -rf "$DEST/bin" "$DEST/lib"
cp -RL "$root/bin" "$DEST/bin"
[[ -d "$root/lib" ]] && cp -RL "$root/lib" "$DEST/lib"
chmod +x "$DEST/bin/sherpa-onnx-offline"
echo "[parakeet] staged bin + $(find "$DEST/lib" -name '*.dylib' 2>/dev/null | wc -l | tr -d ' ') dylib(s)"

# Dependency-closure gate: every @rpath/<name> the binary loads must resolve to a real
# file under lib/ (the 0.0.28 trap was a missing linked dylib). Fails the build if not.
missing=0
while IFS= read -r name; do
  [[ -f "$DEST/lib/$name" ]] || { echo "[parakeet] MISSING linked dylib: $name" >&2; missing=$((missing + 1)); }
done < <(otool -L "$DEST/bin/sherpa-onnx-offline" | awk '/@rpath\//{print $1}' | sed 's|@rpath/||')
if [[ "$missing" -gt 0 ]]; then echo "[parakeet] $missing @rpath dylib(s) unstaged - not shippable" >&2; exit 1; fi

# minos gate: a binary built against a newer SDK silently refuses to launch on older
# macOS. Log it so a too-new floor is caught in review (mirrors build-llama.sh).
otool -l "$DEST/bin/sherpa-onnx-offline" | awk '/LC_BUILD_VERSION/{f=1} f&&/minos/{print "[parakeet] engine minos="$2; exit}'

echo "[parakeet] downloading model…"
curl -fsSL "$PARAKEET_MODEL_URL" -o "$work/model.tgz"
tar -xzf "$work/model.tgz" -C "$work"
for f in encoder.onnx decoder.onnx joiner.onnx tokens.txt; do
  src="$(find "$work" -type f -name "$f" | head -1)"
  if [[ -z "$src" ]]; then echo "[parakeet] model file $f missing from archive" >&2; exit 1; fi
  cp "$src" "$MODEL_DIR/$f"
done

# Gate: any /opt/homebrew or /usr/local dep won't exist on a user's Mac (same rule as the
# llama engine). Check the binary AND every staged dylib. Fail loudly rather than ship
# something that can't launch.
for f in "$DEST/bin/sherpa-onnx-offline" "$DEST"/lib/*.dylib; do
  [[ -f "$f" ]] || continue
  if otool -L "$f" | grep -qE '/opt/homebrew|/usr/local'; then
    echo "[parakeet] foreign dylib dependency in $(basename "$f") - not shippable" >&2
    otool -L "$f" >&2
    exit 1
  fi
done

echo "[parakeet] staged:"
ls -la "$DEST/bin" "$MODEL_DIR"
