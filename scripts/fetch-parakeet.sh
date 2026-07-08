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

: "${SHERPA_ONNX_URL:=}"      # tarball containing sherpa-onnx-offline for macOS arm64
: "${PARAKEET_MODEL_URL:=}"   # OPTIONAL tarball of encoder/decoder/joiner/tokens (else the
                              # in-app Models picker downloads the model at runtime)
: "${SHERPA_ONNX_SHA256:=}"   # OPTIONAL expected sha256 of the runtime tarball
: "${PARAKEET_MODEL_SHA256:=}" # OPTIONAL expected sha256 of the model tarball

if [[ -z "$SHERPA_ONNX_URL" ]]; then
  echo "[parakeet] SHERPA_ONNX_URL not set — skipping (whisper stays the engine)."
  exit 0
fi

# Supply-chain guards: this stages a remote tarball into a signed release artifact, so
# verify integrity and never let an archive write outside the temp dir.
#   verify_sha256 <file> <expected>  — abort on mismatch (no-op when expected is empty).
verify_sha256() {
  local file="$1" expected="$2"
  [[ -z "$expected" ]] && { echo "[parakeet] WARNING: no sha256 pinned for $(basename "$file") — pin *_SHA256 to verify the download" >&2; return 0; }
  local actual; actual="$(shasum -a 256 "$file" | awk '{print $1}')"
  if [[ "$actual" != "$expected" ]]; then
    echo "[parakeet] sha256 mismatch for $(basename "$file"): got $actual, expected $expected" >&2
    exit 1
  fi
  echo "[parakeet] sha256 verified: $(basename "$file")"
}

# Reject absolute paths, parent-dir traversal, and symlink/hardlink entries BEFORE
# extracting — a tampered archive could otherwise write outside "$work".
safe_extract() {
  local tarball="$1" dest="$2"
  # Read the full listing FIRST, then grep the string. Piping `tar -tf | grep -q`
  # under `set -o pipefail` fails OPEN: grep closes the pipe on its first match, tar
  # dies with SIGPIPE (141), the pipeline is non-zero, the `if` is false, and the
  # malicious archive extracts anyway. Materializing the listing avoids the SIGPIPE.
  local listing
  listing="$(tar -tf "$tarball")"
  if printf '%s\n' "$listing" | grep -Eq '(^/|(^|/)\.\.(/|$))'; then
    echo "[parakeet] archive contains absolute or traversal paths — refusing to extract" >&2
    exit 1
  fi
  tar -xf "$tarball" -C "$dest" # -xf auto-detects gz/bz2/xz
}

mkdir -p "$DEST"

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

echo "[parakeet] downloading runtime…"
curl -fsSL "$SHERPA_ONNX_URL" -o "$work/sherpa.tar"
verify_sha256 "$work/sherpa.tar" "$SHERPA_ONNX_SHA256"
safe_extract "$work/sherpa.tar" "$work"
# Find the offline CLI, then take the bin/ + lib/ pair around it. We PRESERVE the
# prebuilt's own bin/lib structure (dylibs live in ../lib, which is what the binary's
# @rpath expects) rather than flatten — flattening would break @rpath. No symlinks are
# copied as symlinks: cp -RL follows them into real files (none inside a signed .app).
# find -name is an exact basename match, so this is only the offline ASR CLI (not the
# -tts / -websocket-server / etc. executables in the same bin/).
bin="$(find "$work" -type f -name 'sherpa-onnx-offline' | head -1)"
if [[ -z "$bin" ]]; then echo "[parakeet] sherpa-onnx-offline not found in archive" >&2; exit 1; fi
rm -rf "$DEST/bin" "$DEST/lib"
mkdir -p "$DEST/bin"
# Copy ONLY the one binary we use (the archive ships ~40 executables at ~27MB each). The
# static build is self-contained; if this is a shared build, also bring its lib/ so the
# binary's @rpath resolves.
cp -L "$bin" "$DEST/bin/sherpa-onnx-offline"
libsrc="$(dirname "$(dirname "$bin")")/lib"
[[ -d "$libsrc" ]] && cp -RL "$libsrc" "$DEST/lib"
chmod +x "$DEST/bin/sherpa-onnx-offline"
echo "[parakeet] staged sherpa-onnx-offline + $(find "$DEST/lib" -name '*.dylib' 2>/dev/null | wc -l | tr -d ' ') dylib(s)"

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

if [[ -z "$PARAKEET_MODEL_URL" ]]; then
  echo "[parakeet] no PARAKEET_MODEL_URL — model comes from the in-app Models picker at runtime."
  echo "[parakeet] staged:"; ls -la "$DEST/bin"; exit 0
fi

echo "[parakeet] downloading model…"
mkdir -p "$MODEL_DIR"
curl -fsSL "$PARAKEET_MODEL_URL" -o "$work/model.tar"
verify_sha256 "$work/model.tar" "$PARAKEET_MODEL_SHA256"
safe_extract "$work/model.tar" "$work"
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
