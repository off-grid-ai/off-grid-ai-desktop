/**
 * Resolve build and environment overrides. `undefined` means the caller must use
 * the real license entitlement result.
 */
export function getForcedProActivation(
  proBundled: boolean,
  environmentOverride: string | undefined
): boolean | undefined {
  if (!proBundled || environmentOverride === '0') {
    return false
  }
  if (environmentOverride === '1') {
    return true
  }
  return undefined
}
