/**
 * IO tests for the residency getters/setters (getResidency / getResidencyMode /
 * setResidencyMode). The pure normalize/lock logic is covered in runtime-residency.test.ts;
 * this file exercises the persistence round trip through a REAL (in-memory) settings store
 * that mirrors database.getSetting/saveSetting (JSON round trip, default on miss/parse
 * failure). Only that store boundary is faked — the residency logic runs for real, so a
 * regression in the lock-coercion-on-persist path fails loudly here.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

// In-memory app_settings mirror: saveSetting JSON-stringifies, getSetting JSON-parses and
// returns the default on a miss or a corrupt value — the exact contract database.ts has.
const store = new Map<string, string>()
vi.mock('../database', () => ({
  saveSetting: (key: string, value: unknown) => {
    store.set(key, JSON.stringify(value))
  },
  getSetting: <T>(key: string, def: T): T => {
    const raw = store.get(key)
    if (raw === undefined) return def
    try {
      return JSON.parse(raw) as T
    } catch {
      return def
    }
  }
}))

import {
  getResidency,
  getResidencyMode,
  setResidencyMode,
  DEFAULT_RESIDENCY
} from '../runtime-residency'

const KEY = 'runtime:residency'

beforeEach(() => {
  store.clear()
})

describe('getResidency', () => {
  it('returns the defaults when nothing is persisted', () => {
    expect(getResidency()).toEqual(DEFAULT_RESIDENCY)
  })

  it('normalizes a persisted partial map (fills missing, coerces locked)', () => {
    store.set(KEY, JSON.stringify({ image: 'resident', llm: 'on-demand' }))
    const r = getResidency()
    expect(r.image).toBe('resident') // honored
    expect(r.llm).toBe('resident') // locked -> coerced back from persisted on-demand
    expect(r.stt).toBe('on-demand') // missing -> default
    expect(r.tts).toBe('on-demand')
  })

  it('falls back to defaults when the persisted value is corrupt', () => {
    store.set(KEY, '{not json')
    expect(getResidency()).toEqual(DEFAULT_RESIDENCY)
  })
})

describe('getResidencyMode', () => {
  it('reads one modality out of the persisted map', () => {
    setResidencyMode('tts', 'resident')
    expect(getResidencyMode('tts')).toBe('resident')
    expect(getResidencyMode('image')).toBe('on-demand') // still default
  })
})

describe('setResidencyMode', () => {
  it('persists a mode for an unlocked modality and returns the full updated map', () => {
    const next = setResidencyMode('image', 'resident')
    expect(next.image).toBe('resident')
    // Round trip: a fresh read sees the persisted value.
    expect(getResidencyMode('image')).toBe('resident')
  })

  it('ignores the requested mode for a locked modality and keeps it resident', () => {
    const next = setResidencyMode('llm', 'on-demand')
    expect(next.llm).toBe('resident') // locked -> forced resident
    expect(getResidencyMode('llm')).toBe('resident')
  })

  it('does not clobber other modalities when setting one', () => {
    setResidencyMode('stt', 'resident')
    setResidencyMode('tts', 'resident')
    const r = getResidency()
    expect(r.stt).toBe('resident')
    expect(r.tts).toBe('resident')
    expect(r.image).toBe('on-demand') // untouched
  })

  it('a locked value written to the store is still coerced resident on the next read', () => {
    // Simulate a hand-edited/stale on-demand for the locked llm sneaking into the store.
    store.set(KEY, JSON.stringify({ llm: 'on-demand', image: 'resident' }))
    expect(getResidencyMode('llm')).toBe('resident') // normalize coerces it back
    expect(getResidencyMode('image')).toBe('resident')
  })
})
