/**
 * The queue config seam — the single source for the persisted setting keys +
 * defaults, and how they read/apply to the live queue. Guards that startup and the
 * settings IPC can't drift on the keys/defaults, and that applying a config drives
 * the real queue setters.
 */
import { describe, it, expect, vi } from 'vitest'
import {
  readQueueConfig,
  applyQueueConfig,
  QUEUE_DEFAULTS,
  QUEUE_ENABLED_KEY,
  TIER1_COEXIST_KEY
} from '../config'

describe('readQueueConfig', () => {
  it('returns the defaults when nothing is persisted (enabled + coexist on)', () => {
    const get = <T>(_k: string, d: T): T => d
    expect(readQueueConfig(get)).toEqual({ enabled: true, tier1Coexists: true })
    expect(QUEUE_DEFAULTS).toEqual({ enabled: true, tier1Coexists: true })
  })

  it('reads each value from its own key', () => {
    const store: Record<string, unknown> = {
      [QUEUE_ENABLED_KEY]: false,
      [TIER1_COEXIST_KEY]: false
    }
    const get = <T>(k: string, d: T): T => (k in store ? (store[k] as T) : d)
    expect(readQueueConfig(get)).toEqual({ enabled: false, tier1Coexists: false })
  })
})

describe('applyQueueConfig', () => {
  it('drives the queue setters with the config values', () => {
    const setEnabled = vi.fn()
    const setTier1CoexistsWithTier2 = vi.fn()
    applyQueueConfig(
      { setEnabled, setTier1CoexistsWithTier2 },
      { enabled: false, tier1Coexists: true }
    )
    expect(setEnabled).toHaveBeenCalledWith(false)
    expect(setTier1CoexistsWithTier2).toHaveBeenCalledWith(true)
  })

  it('round-trips through the REAL queue: config → live behavior', async () => {
    // Prove the seam against the actual ModalityQueue, not a stub: disabling the
    // queue makes run() execute immediately (concurrent), which is the observable
    // effect of enabled=false.
    const { ModalityQueue } = await import('../queue')
    const q = new ModalityQueue()
    applyQueueConfig(q, { enabled: false, tier1Coexists: true })
    expect(q.isEnabled()).toBe(false)
    applyQueueConfig(q, { enabled: true, tier1Coexists: false })
    expect(q.isEnabled()).toBe(true)
  })
})
