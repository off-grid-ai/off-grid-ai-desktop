import {
  deviceNoun as nounForPlatform,
  isMac as isMacForPlatform,
  type DevicePlatform
} from '@offgrid/core/shared/device'

// Renderer-side convenience over the shared device rules. Resolves the platform
// from the value the preload bridge exposes (`window.api.platform`) so callers
// don't thread it through. Falls back to a non-Mac label ('device' / not-Mac) if
// the bridge value is missing, so copy + gating degrade safely rather than throw.

/** The current platform as seen by the renderer (single source for the wrappers). */
export function currentPlatform(): DevicePlatform {
  return (typeof window !== 'undefined' ? window.api.platform : undefined) ?? 'unknown'
}

/** The user-facing name for this machine ('Mac' on macOS, else 'device'). */
export function deviceNoun(opts?: { capitalize?: boolean }): string {
  return nounForPlatform(currentPlatform(), opts)
}

/** True when running on macOS. The device flag for platform-gating Pro features. */
export function isMac(): boolean {
  return isMacForPlatform(currentPlatform())
}
