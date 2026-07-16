// Tests for the pro view-router seam (bootstrap/proView.ts).
// Module-level singleton -> each test re-imports fresh for isolation.
import { describe, it, expect, beforeEach, vi } from 'vitest'

type ProViewModule = typeof import('../../bootstrap/proView')

async function fresh(): Promise<ProViewModule> {
  vi.resetModules()
  return import('../../bootstrap/proView')
}

// A minimal context bag - renderProView only forwards it to the registered fn.
function ctx(): import('../../bootstrap/proView').ProViewContext {
  return {} as unknown as import('../../bootstrap/proView').ProViewContext
}

describe('proView', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('renderProView returns null when no renderer is registered', async () => {
    const m = await fresh()
    expect(m.renderProView('day', ctx())).toBeNull()
  })

  it('delegates to a registered renderer and returns its result', async () => {
    const m = await fresh()
    m.registerProView((viewMode) => `screen:${viewMode}`)
    expect(m.renderProView('replay', ctx())).toBe('screen:replay')
  })

  it('forwards both the view mode and the context bag', async () => {
    const m = await fresh()
    const seen: { view: string; ctx: unknown }[] = []
    const c = ctx()
    m.registerProView((view, gotCtx) => {
      seen.push({ view, ctx: gotCtx })
      return null
    })
    m.renderProView('entities', c)
    expect(seen).toEqual([{ view: 'entities', ctx: c }])
  })

  it('a second register replaces the renderer', async () => {
    const m = await fresh()
    m.registerProView(() => 'first')
    m.registerProView(() => 'second')
    expect(m.renderProView('x', ctx())).toBe('second')
  })

  it('a registered renderer may itself return null (no matching screen)', async () => {
    const m = await fresh()
    m.registerProView(() => null)
    expect(m.renderProView('unknown', ctx())).toBeNull()
  })
})
