// Cache cleanup is intentionally restricted to Chromium's explicitly classified
// cache data. It never receives userData paths, so chats, projects, models, vault,
// settings, and entitlement files are unreachable by construction.
import { session } from 'electron'
import type { CacheCleanupResultContract } from '../shared/ipc-contracts'

async function measuredCacheSize(): Promise<number | null> {
  try {
    return await session.defaultSession.getCacheSize()
  } catch {
    return null
  }
}

export async function clearEphemeralCache(): Promise<CacheCleanupResultContract> {
  const before = await measuredCacheSize()
  // Electron's `cache` data type covers disposable network, CacheStorage, shared
  // dictionary, and shader caches. The explicit allowlist excludes cookies,
  // localStorage, IndexedDB, downloads, and every app-owned filesystem store.
  await session.defaultSession.clearData({ dataTypes: ['cache'] })
  const after = await measuredCacheSize()
  return {
    success: true,
    freedBytes: before == null || after == null ? null : Math.max(0, before - after)
  }
}
