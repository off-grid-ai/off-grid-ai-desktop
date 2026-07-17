const NETWORK_UNAVAILABLE_CODES = new Set(['ENOTFOUND', 'EAI_AGAIN', 'ENETUNREACH'])
const STORAGE_CAPACITY_CODES = new Set(['ENOSPC', 'EDQUOT'])

export const NETWORK_UNAVAILABLE_MESSAGE =
  'Unable to download model: network unavailable. Check your connection and retry.'

interface ErrorWithCause {
  message?: unknown
  code?: unknown
  cause?: unknown
}

function errorCode(error: unknown): unknown {
  const outer = typeof error === 'object' && error !== null ? (error as ErrorWithCause) : undefined
  const cause =
    typeof outer?.cause === 'object' && outer.cause !== null
      ? (outer.cause as ErrorWithCause)
      : undefined
  return outer?.code ?? cause?.code
}

/** Whether a failed write exhausted the target volume or its quota. */
export function isStorageCapacityError(error: unknown): boolean {
  const code = errorCode(error)
  return typeof code === 'string' && STORAGE_CAPACITY_CODES.has(code)
}

function thrownValueMessage(error: unknown): string {
  if (error === null) return 'null'
  if (typeof error === 'string') return error
  if (typeof error === 'number' || typeof error === 'boolean' || typeof error === 'bigint') {
    return `${error}`
  }
  if (typeof error === 'symbol') return error.description ?? 'Symbol'
  return 'Model download failed.'
}

/** Normalize runtime/network errors at the download boundary while preserving
 * specific failures (disk full, HTTP status, integrity errors) verbatim. */
export function downloadFailureMessage(error: unknown): string {
  const outer = typeof error === 'object' && error !== null ? (error as ErrorWithCause) : undefined
  const code = errorCode(error)
  if (typeof code === 'string' && NETWORK_UNAVAILABLE_CODES.has(code)) {
    return NETWORK_UNAVAILABLE_MESSAGE
  }
  if (error instanceof Error) return error.message
  if (typeof outer?.message === 'string') return outer.message
  return thrownValueMessage(error)
}
