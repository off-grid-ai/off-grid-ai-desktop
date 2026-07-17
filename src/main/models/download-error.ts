const NETWORK_UNAVAILABLE_CODES = new Set(['ENOTFOUND', 'EAI_AGAIN', 'ENETUNREACH'])

export const NETWORK_UNAVAILABLE_MESSAGE =
  'Unable to download model: network unavailable. Check your connection and retry.'

interface ErrorWithCause {
  message?: unknown
  code?: unknown
  cause?: unknown
}

/** Normalize runtime/network errors at the download boundary while preserving
 * specific failures (disk full, HTTP status, integrity errors) verbatim. */
export function downloadFailureMessage(error: unknown): string {
  const outer = typeof error === 'object' && error !== null ? (error as ErrorWithCause) : undefined
  const cause =
    typeof outer?.cause === 'object' && outer.cause !== null
      ? (outer.cause as ErrorWithCause)
      : undefined
  const code = typeof outer?.code === 'string' ? outer.code : cause?.code
  if (typeof code === 'string' && NETWORK_UNAVAILABLE_CODES.has(code)) {
    return NETWORK_UNAVAILABLE_MESSAGE
  }
  return error instanceof Error ? error.message : String(error)
}
