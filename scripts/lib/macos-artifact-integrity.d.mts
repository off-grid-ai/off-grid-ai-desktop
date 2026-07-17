export const REQUIRED_MAC_BUNDLE_FILES: readonly string[]
export const REQUIRED_EXECUTABLE_FILES: ReadonlySet<string>

export function verifyBundlePair(referenceBundle: string, candidateBundle: string): void
export function verifyDmgArtifact(dmgPath: string, referenceBundle: string): Promise<void>
