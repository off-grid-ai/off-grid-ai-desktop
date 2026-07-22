export interface OfflineFetchBoundary {
  fetch: typeof globalThis.fetch
  blockedRequests: string[]
}

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]'])

function requestUrl(input: Parameters<typeof fetch>[0]): URL {
  return new URL(typeof input === 'string' || input instanceof URL ? input.toString() : input.url)
}

/**
 * A process-local offline boundary for integration tests. Production loopback transports remain
 * real; every outbound request is recorded and rejected so a local workflow cannot silently pass
 * while reaching the internet.
 */
export function createOfflineFetchBoundary(
  loopbackFetch: typeof globalThis.fetch = globalThis.fetch.bind(globalThis)
): OfflineFetchBoundary {
  const blockedRequests: string[] = []
  const offlineFetch = (async (
    input: Parameters<typeof fetch>[0],
    init?: Parameters<typeof fetch>[1]
  ) => {
    const target = requestUrl(input)
    if (LOOPBACK_HOSTS.has(target.hostname)) return loopbackFetch(input, init)
    blockedRequests.push(target.href)
    throw new TypeError(`network unavailable in offline integration fixture: ${target.origin}`)
  }) satisfies typeof globalThis.fetch
  return { fetch: offlineFetch, blockedRequests }
}
