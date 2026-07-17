#!/usr/bin/env bash
#
# Local macOS test builds — produces BOTH the core (free) and pro DMGs from a
# single checkout, UNSIGNED and WITHOUT notarization or GitHub publishing, so you
# can smoke-test the packaged app before any real release.
#
#   - Signing/notarization are skipped (CSC_IDENTITY_AUTO_DISCOVERY=false +
#     -c.mac.notarize=false) so there are no cert/Apple-ID prompts. The DMGs are
#     unsigned: on first launch, right-click the app → Open to bypass Gatekeeper.
#   - --publish never: nothing touches GitHub.
#   - Core uses OFFGRID_FORCE_CORE=1 so the pro/ submodule (present in this
#     checkout) is aliased to the stub, exactly like a real free build.
#
# Output: dist/OffGrid-core-<version>.dmg and dist/OffGrid-pro-<version>.dmg
#
# Usage:  ./scripts/build-mac-local.sh           (both)
#         ./scripts/build-mac-local.sh core       (core only)
#         ./scripts/build-mac-local.sh pro        (pro only)

set -euo pipefail
cd "$(dirname "$0")/.."

VERSION=$(node -p "require('./package.json').version")
TARGET="${1:-both}"

export CSC_IDENTITY_AUTO_DISCOVERY=false # unsigned local builds
export OFFGRID_ALLOW_UNSIGNED_ARTIFACT=1 # integrity is enforced; codesign is release-only

# Guard against the bug that broke the last release: the runtime binaries in
# resources/bin/ are stored in Git LFS. If they're still 131-byte pointer stubs,
# the packaged app ships a broken llama-server/whisper/ffmpeg and "doesn't work".
check_lfs() {
  echo "==> Checking LFS binaries are hydrated (not pointer stubs)…"
  local stubs
  stubs=$(find resources/bin -type f 2>/dev/null | while read -r f; do
    # LFS pointer files are tiny and start with the LFS spec line.
    if [ "$(wc -c < "$f")" -lt 200 ] && head -1 "$f" | grep -q "git-lfs"; then echo "$f"; fi
  done)
  if [ -n "$stubs" ]; then
    echo "!! These are LFS pointer stubs, not real binaries — run 'git lfs pull' first:"
    echo "$stubs"
    exit 1
  fi
  echo "   OK"
}

build_core() {
  echo "==> Building CORE (free) macOS DMG  v$VERSION"
  OFFGRID_FORCE_CORE=1 npx electron-vite build
  npx electron-builder --mac \
    -c.mac.notarize=false \
    -c.productName="Off Grid AI Desktop" \
    -c.appId="co.getoffgridai.desktop" \
    -c.dmg.artifactName="OffGrid-core-\${version}.dmg" \
    --publish never
}

build_pro() {
  echo "==> Building PRO macOS DMG  v$VERSION"
  npx electron-vite build
  npx electron-builder --mac \
    -c.mac.notarize=false \
    -c.productName="Off Grid AI Desktop" \
    -c.appId="co.getoffgridai.desktop.pro" \
    -c.dmg.artifactName="OffGrid-pro-\${version}.dmg" \
    --publish never
}

check_lfs
case "$TARGET" in
  core) build_core ;;
  pro)  build_pro ;;
  both) build_core; build_pro ;;
  *) echo "usage: $0 [core|pro|both]"; exit 1 ;;
esac

echo "==> Done. DMGs:"
ls -lh dist/*.dmg 2>/dev/null || echo "(no DMGs found in dist/)"
