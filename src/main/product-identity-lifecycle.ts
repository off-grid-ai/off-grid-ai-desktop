import { PRODUCT_NAME } from '../shared/product-identity'

/**
 * Electron derives macOS safeStorage's Keychain service from the application
 * name during early bootstrap. Released builds before 0.0.40 used this name,
 * so changing it would strand encrypted database keys, licenses, and connector
 * secrets in a different Keychain namespace.
 */
export const SAFE_STORAGE_COMPATIBILITY_NAME = 'Off Grid AI'

export interface ProductIdentityBoundary {
  setName(name: string): void
}

/**
 * Hold the legacy crypto namespace only during Electron bootstrap, then restore
 * the canonical visible identity as soon as the ready phase begins.
 */
export function beginProductIdentityBootstrap(
  boundary: ProductIdentityBoundary,
  platform: NodeJS.Platform
): () => void {
  if (platform !== 'darwin') {
    boundary.setName(PRODUCT_NAME)
    return () => {}
  }

  // Electron 39.2.7 loads the user main module during PostEarlyInitialization,
  // then snapshots this name for macOS KeychainPassword in
  // PostCreateMainMessageLoop. Re-audit that lifecycle before an Electron upgrade.
  boundary.setName(SAFE_STORAGE_COMPATIBILITY_NAME)
  return () => boundary.setName(PRODUCT_NAME)
}
