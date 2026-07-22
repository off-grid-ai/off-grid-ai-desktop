// Single source of truth for the ModalityQueue's persisted config — the setting
// keys, their defaults, and how they read/apply to the live queue. Previously the
// keys + defaults were spelled inline at startup (index.ts); the control-surface
// IPC needs the exact same keys, so they live here once and both sides import it.
// Pure (the setting getter is injected) so it's unit-testable without electron.

import type { ModalityQueue } from './queue'

export const QUEUE_ENABLED_KEY = 'modalityQueueEnabled'
export const TIER1_COEXIST_KEY = 'modalityTier1CoexistsWithTier2'
export const QUEUE_DEFAULTS = { enabled: true, tier1Coexists: true } as const

export interface QueueConfig {
  /** Serialize heavy model jobs by priority + evict to keep one heavy model
   *  resident. Off = the pre-queue concurrent behavior. */
  enabled: boolean
  /** Let live speech (tier-1 dictation) run alongside a heavy foreground job so
   *  speech never stalls behind it. */
  tier1Coexists: boolean
}

/** Read the persisted queue config through an injected getter (so tests don't need
 *  the real settings DB). */
export function readQueueConfig(get: <T>(key: string, def: T) => T): QueueConfig {
  return {
    enabled: get(QUEUE_ENABLED_KEY, QUEUE_DEFAULTS.enabled),
    tier1Coexists: get(TIER1_COEXIST_KEY, QUEUE_DEFAULTS.tier1Coexists)
  }
}

/** Apply a config to the live queue. Both the startup path and the settings IPC
 *  call this, so a config change takes effect the same way everywhere. */
export function applyQueueConfig(
  queue: Pick<ModalityQueue, 'setEnabled' | 'setTier1CoexistsWithTier2'>,
  cfg: QueueConfig
): void {
  queue.setEnabled(cfg.enabled)
  queue.setTier1CoexistsWithTier2(cfg.tier1Coexists)
}
