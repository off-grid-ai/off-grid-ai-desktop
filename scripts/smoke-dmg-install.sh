#!/usr/bin/env bash
# Verify the install path users actually receive from a macOS DMG without writing to
# /Applications. The image is mounted read-only, its single canonical app bundle is
# copied with ditto into a throwaway install directory, the source image is detached,
# and the existing packaged-app smoke runs against the copied bundle.
#
# Usage:
#   npm run smoke:dmg -- dist/OffGrid-0.0.38.dmg
#
# Env:
#   DMG_SMOKE_RUNNER=<shell script>  Override only the final launch/smoke boundary.
#                                    The runner receives APP=<copied .app path>.

set -euo pipefail

REPO_ROOT=$(cd "$(dirname "$0")/.." && pwd)
DMG_PATH="${1:-${DMG:-}}"
EXPECTED_APP_NAME="${EXPECTED_APP_NAME:-Off Grid AI Desktop.app}"
SMOKE_RUNNER="${DMG_SMOKE_RUNNER:-$REPO_ROOT/scripts/smoke-packaged.sh}"

if [ "$(uname -s)" != "Darwin" ]; then
  echo "[dmg-smoke] macOS is required because DMG mounting uses hdiutil" >&2
  exit 2
fi
if [ -z "$DMG_PATH" ] || [ ! -f "$DMG_PATH" ]; then
  echo "[dmg-smoke] pass an existing DMG path as the first argument or DMG=<path>" >&2
  exit 2
fi
if [ ! -f "$SMOKE_RUNNER" ]; then
  echo "[dmg-smoke] smoke runner not found: $SMOKE_RUNNER" >&2
  exit 2
fi

WORK_ROOT=$(mktemp -d "${TMPDIR:-/tmp}/offgrid-dmg-install.XXXXXX")
MOUNT_POINT="$WORK_ROOT/mount"
INSTALL_ROOT="$WORK_ROOT/install"
ATTACHED=0
mkdir -p "$MOUNT_POINT" "$INSTALL_ROOT"

cleanup() {
  if [ "$ATTACHED" = 1 ]; then
    hdiutil detach "$MOUNT_POINT" -force >/dev/null 2>&1 || true
  fi
  rm -rf "$WORK_ROOT"
}
trap cleanup EXIT

echo "[dmg-smoke] mounting read-only: $DMG_PATH"
hdiutil attach "$DMG_PATH" -readonly -nobrowse -mountpoint "$MOUNT_POINT" >/dev/null
ATTACHED=1

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

INSTALLED_APP="$INSTALL_ROOT/$EXPECTED_APP_NAME"
echo "[dmg-smoke] copying with ditto to temporary install root"
/usr/bin/ditto "$SOURCE_APP" "$INSTALLED_APP"

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
hdiutil detach "$MOUNT_POINT" >/dev/null
ATTACHED=0

echo "[dmg-smoke] detached source; running packaged smoke against copied app"
APP="$INSTALLED_APP" OFFGRID_DMG_MOUNT_POINT="$MOUNT_POINT" bash "$SMOKE_RUNNER"
echo "[dmg-smoke] installed-copy smoke passed"
