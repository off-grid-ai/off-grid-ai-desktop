export type ClipboardWriter = (text: string) => Promise<boolean | void>

/**
 * Write through Electron first, then fall back to the browser clipboard when the
 * bridge rejects or reports a failed native write. Clipboard APIs are external
 * boundaries, so this function normalizes their failure contracts for the UI.
 */
export async function writeClipboardWithFallback(
  text: string,
  bridgeWriter: ClipboardWriter | undefined,
  browserWriter: ClipboardWriter
): Promise<boolean> {
  if (bridgeWriter) {
    try {
      if ((await bridgeWriter(text)) !== false) return true
    } catch {
      // Try the renderer clipboard below.
    }
  }

  try {
    return (await browserWriter(text)) !== false
  } catch {
    return false
  }
}
