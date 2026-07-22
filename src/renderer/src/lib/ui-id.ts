/** Generate collision-resistant IDs for renderer-owned, ephemeral records. */
export function createUiId(prefix: string): string {
  return `${prefix}-${globalThis.crypto.randomUUID()}`
}
