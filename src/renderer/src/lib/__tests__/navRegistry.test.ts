// Tests for the renderer nav-registry seam (src/renderer/src/bootstrap/navRegistry.ts).
// The registry is a module-level singleton, so each test re-imports it fresh via
// vi.resetModules() + dynamic import to isolate registrations.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { ComponentType } from 'react'

type NavModule = typeof import('../../bootstrap/navRegistry')

// A throwaway icon component - the registry only stores it, never renders it here.
const Icon = (() => null) as unknown as ComponentType<Record<string, unknown>>

async function fresh(): Promise<NavModule> {
  vi.resetModules()
  return import('../../bootstrap/navRegistry')
}

describe('navRegistry', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('starts empty - no entries, pro inactive', async () => {
    const m = await fresh()
    expect(m.getRegisteredNav()).toEqual([])
    expect(m.isProActive()).toBe(false)
  })

  it('registers a single entry and reports pro active', async () => {
    const m = await fresh()
    m.registerNav({ route: 'day', label: 'Day', icon: Icon })
    expect(m.getRegisteredNav()).toHaveLength(1)
    expect(m.getRegisteredNav()[0]!.route).toBe('day')
    expect(m.isProActive()).toBe(true)
  })

  it('dedupes by route - a second register of the same route is ignored', async () => {
    const m = await fresh()
    m.registerNav({ route: 'day', label: 'Day', icon: Icon })
    m.registerNav({ route: 'day', label: 'Day (again)', icon: Icon })
    const nav = m.getRegisteredNav()
    expect(nav).toHaveLength(1)
    // First registration wins - the label is the original, not the duplicate.
    expect(nav[0]!.label).toBe('Day')
  })

  it('keeps distinct routes', async () => {
    const m = await fresh()
    m.registerNav({ route: 'day', label: 'Day', icon: Icon })
    m.registerNav({ route: 'reflect', label: 'Reflect', icon: Icon })
    expect(m.getRegisteredNav().map((e) => e.route)).toEqual(['day', 'reflect'])
  })

  it('sorts by order ascending (lower first)', async () => {
    const m = await fresh()
    m.registerNav({ route: 'b', label: 'B', icon: Icon, order: 200 })
    m.registerNav({ route: 'a', label: 'A', icon: Icon, order: 100 })
    m.registerNav({ route: 'c', label: 'C', icon: Icon, order: 150 })
    expect(m.getRegisteredNav().map((e) => e.route)).toEqual(['a', 'c', 'b'])
  })

  it('defaults a missing order to 100 for sorting', async () => {
    const m = await fresh()
    // no order => treated as 100; explicit 50 sorts before it, 150 after.
    m.registerNav({ route: 'noOrder', label: 'None', icon: Icon })
    m.registerNav({ route: 'low', label: 'Low', icon: Icon, order: 50 })
    m.registerNav({ route: 'high', label: 'High', icon: Icon, order: 150 })
    expect(m.getRegisteredNav().map((e) => e.route)).toEqual(['low', 'noOrder', 'high'])
  })

  it('getRegisteredNav returns a fresh sorted copy - not the live array', async () => {
    const m = await fresh()
    m.registerNav({ route: 'a', label: 'A', icon: Icon })
    const first = m.getRegisteredNav()
    first.push({ route: 'injected', label: 'X', icon: Icon })
    // Mutating the returned array must not affect the registry.
    expect(m.getRegisteredNav()).toHaveLength(1)
  })
})
