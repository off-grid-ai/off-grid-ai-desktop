#!/usr/bin/env bash
# Verify the install path users actually receive from a macOS DMG without writing to
# /Applications. The image is mounted read-only, its single canonical app bundle is
# copied with ditto into a throwaway install directory, the source image is detached,
# and the existing packaged UI smoke runs against the copied bundle on a fresh
# temporary profile.
#
# Usage:
#   npm run smoke:dmg -- dist/OffGrid-core-<version>.dmg
#
# Env:
#   DMG_REFERENCE_APP=<path>        Compare the DMG and installed copy against the
#                                   signed app bundle electron-builder packaged.
#   DMG_SMOKE_RUNNER=<shell script>  Override only the final launch/smoke boundary.
#                                    The runner receives APP=<copied .app path>.
#                                    Set scripts/smoke-packaged.sh for the deeper
#                                    model/runtime smoke when its prerequisites exist.

set -euo pipefail

REPO_ROOT=$(cd "$(dirname "$0")/.." && pwd)
DMG_PATH="${1:-${DMG:-}}"
EXPECTED_APP_NAME="${EXPECTED_APP_NAME:-Off Grid AI Desktop.app}"
SMOKE_RUNNER="${DMG_SMOKE_RUNNER:-}"
REFERENCE_APP="${DMG_REFERENCE_APP:-}"
DMG_COMMAND_TIMEOUT_MS="${DMG_COMMAND_TIMEOUT_MS:-120000}"
HDIUTIL_BIN="${DMG_HDIUTIL:-/usr/bin/hdiutil}"

if [ "${OFFGRID_REQUIRE_RELEASE_TRUST:-0}" = 1 ] && [ "$HDIUTIL_BIN" != /usr/bin/hdiutil ]; then
  echo "[dmg-smoke] release verification cannot override /usr/bin/hdiutil" >&2
  exit 2
fi

run_hdiutil() {
  node "$REPO_ROOT/scripts/exec-with-timeout.mjs" \
    "$DMG_COMMAND_TIMEOUT_MS" "$HDIUTIL_BIN" "$@"
}

if [ "$(uname -s)" != "Darwin" ]; then
  echo "[dmg-smoke] macOS is required because DMG mounting uses hdiutil" >&2
  exit 2
fi
if [ -z "$DMG_PATH" ] || [ ! -f "$DMG_PATH" ]; then
  echo "[dmg-smoke] pass an existing DMG path as the first argument or DMG=<path>" >&2
  exit 2
fi
if [ -n "$SMOKE_RUNNER" ] && [ ! -f "$SMOKE_RUNNER" ]; then
  echo "[dmg-smoke] smoke runner not found: $SMOKE_RUNNER" >&2
  exit 2
fi
if [ -n "$REFERENCE_APP" ] && [ ! -d "$REFERENCE_APP" ]; then
  echo "[dmg-smoke] reference app bundle not found: $REFERENCE_APP" >&2
  exit 2
fi

WORK_ROOT=$(mktemp -d "${TMPDIR:-/tmp}/offgrid-dmg-install.XXXXXX")
MOUNT_POINT="$WORK_ROOT/mount"
INSTALL_ROOT="$WORK_ROOT/install"
ATTACH_ATTEMPTED=0
mkdir -p "$MOUNT_POINT" "$INSTALL_ROOT"

cleanup() {
  local detach_status=0
  if [ "$ATTACH_ATTEMPTED" = 1 ]; then
    run_hdiutil detach "$MOUNT_POINT" -force >/dev/null 2>&1 || detach_status=$?
  fi
  if [ "$detach_status" -ne 0 ]; then
    echo "[dmg-smoke] cleanup could not detach $MOUNT_POINT; leaving $WORK_ROOT intact" >&2
    return
  fi
  rm -rf "$WORK_ROOT"
}
trap cleanup EXIT

echo "[dmg-smoke] mounting read-only: $DMG_PATH"
ATTACH_ATTEMPTED=1
run_hdiutil attach "$DMG_PATH" -readonly -nobrowse -mountpoint "$MOUNT_POINT" >/dev/null

APPS=()
while IFS= read -r app; do
  APPS+=("$app")
done < <(find "$MOUNT_POINT" -type d -name '*.app' -prune -print)

if [ "${#APPS[@]}" -ne 1 ]; then
  echo "[dmg-smoke] expected exactly one .app in the DMG, found ${#APPS[@]}" >&2
  exit 1
fi

SOURCE_APP="${APPS[0]}"
if [ "$(basename "$SOURCE_APP")" != "$EXPECTED_APP_NAME" ]; then
  echo "[dmg-smoke] expected $EXPECTED_APP_NAME, found $(basename "$SOURCE_APP")" >&2
  exit 1
fi

if [ -n "$REFERENCE_APP" ]; then
  echo "[dmg-smoke] comparing mounted bundle with packaged reference"
  node "$REPO_ROOT/scripts/verify-macos-bundle.mjs" "$REFERENCE_APP" "$SOURCE_APP"
fi

INSTALLED_APP="$INSTALL_ROOT/$EXPECTED_APP_NAME"
echo "[dmg-smoke] copying with ditto to temporary install root"
/usr/bin/ditto "$SOURCE_APP" "$INSTALLED_APP"

if [ -n "$REFERENCE_APP" ]; then
  echo "[dmg-smoke] comparing installed bundle with packaged reference"
  node "$REPO_ROOT/scripts/verify-macos-bundle.mjs" "$REFERENCE_APP" "$INSTALLED_APP"
fi

INFO_PLIST="$INSTALLED_APP/Contents/Info.plist"
if [ ! -f "$INFO_PLIST" ]; then
  echo "[dmg-smoke] copied bundle is missing Contents/Info.plist" >&2
  exit 1
fi
BUNDLE_EXECUTABLE=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$INFO_PLIST" 2>/dev/null || true)
if [ -z "$BUNDLE_EXECUTABLE" ] || [ ! -x "$INSTALLED_APP/Contents/MacOS/$BUNDLE_EXECUTABLE" ]; then
  echo "[dmg-smoke] copied bundle has no executable CFBundleExecutable" >&2
  exit 1
fi

# Detach before launch so success cannot depend on files remaining available from
# the mounted image. This is the important difference from launching in-place.
run_hdiutil detach "$MOUNT_POINT" >/dev/null
ATTACH_ATTEMPTED=0

echo "[dmg-smoke] detached source; running packaged helper and UI smoke against copied app"
node "$REPO_ROOT/scripts/probe-packaged-helpers.mjs" "$INSTALLED_APP"
echo "[dmg-smoke] packaged native helper probes passed"
if [ -n "$SMOKE_RUNNER" ]; then
  APP="$INSTALLED_APP" OFFGRID_DMG_MOUNT_POINT="$MOUNT_POINT" bash "$SMOKE_RUNNER"
else
  APP_BIN="$INSTALLED_APP/Contents/MacOS/$BUNDLE_EXECUTABLE" \
    OFFGRID_DMG_MOUNT_POINT="$MOUNT_POINT" \
    node "$REPO_ROOT/scripts/smoke-test.mjs"
  node "$REPO_ROOT/scripts/smoke-license-gate.mjs" \
    "$INSTALLED_APP/Contents/MacOS/$BUNDLE_EXECUTABLE"
fi
echo "[dmg-smoke] installed-copy smoke passed"
