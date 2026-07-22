/**
 * Resolve build and environment overrides. `undefined` means the caller must use
 * the real license entitlement result.
 */
export function getForcedProActivation(
  proBundled: boolean,
  environmentOverride: string | undefined,
  packaged: boolean
): boolean | undefined {
  if (!proBundled || environmentOverride === '0') {
    return false
  }
  if (environmentOverride === '1' && !packaged) {
    return true
  }
  return undefined
}
