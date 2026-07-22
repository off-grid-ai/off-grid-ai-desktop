// Tests for the Settings-section registry seam (bootstrap/sectionRegistry.ts).
// Module-level singleton -> each test re-imports fresh for isolation.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { ComponentType } from 'react'

type SectionModule = typeof import('../../bootstrap/sectionRegistry')

const C = (() => null) as unknown as ComponentType<Record<string, unknown>>

async function fresh(): Promise<SectionModule> {
  vi.resetModules()
  return import('../../bootstrap/sectionRegistry')
}

describe('sectionRegistry', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('starts empty', async () => {
    const m = await fresh()
    expect(m.getRegisteredSettingsSections()).toEqual([])
  })

  it('registers a section', async () => {
    const m = await fresh()
    m.registerSettingsSection({ id: 'proactive', component: C })
    expect(m.getRegisteredSettingsSections().map((s) => s.id)).toEqual(['proactive'])
  })

  it('dedupes by id - a duplicate id is ignored', async () => {
    const m = await fresh()
    m.registerSettingsSection({ id: 'proactive', component: C })
    m.registerSettingsSection({ id: 'proactive', component: C })
    expect(m.getRegisteredSettingsSections()).toHaveLength(1)
  })

  it('sorts by order ascending', async () => {
    const m = await fresh()
    m.registerSettingsSection({ id: 'b', component: C, order: 20 })
    m.registerSettingsSection({ id: 'a', component: C, order: 10 })
    expect(m.getRegisteredSettingsSections().map((s) => s.id)).toEqual(['a', 'b'])
  })

  it('defaults a missing order to 100', async () => {
    const m = await fresh()
    m.registerSettingsSection({ id: 'noOrder', component: C })
    m.registerSettingsSection({ id: 'low', component: C, order: 50 })
    m.registerSettingsSection({ id: 'high', component: C, order: 150 })
    expect(m.getRegisteredSettingsSections().map((s) => s.id)).toEqual(['low', 'noOrder', 'high'])
  })

  it('returns a fresh sorted copy - mutating it does not touch the registry', async () => {
    const m = await fresh()
    m.registerSettingsSection({ id: 'a', component: C })
    m.getRegisteredSettingsSections().push({ id: 'injected', component: C })
    expect(m.getRegisteredSettingsSections()).toHaveLength(1)
  })
})
