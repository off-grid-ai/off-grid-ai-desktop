// Tests for the renderer function-hook registry seam (bootstrap/hookRegistry.ts).
// Module-level singleton -> each test re-imports fresh for isolation.
import { describe, it, expect, beforeEach, vi } from 'vitest'

type HookModule = typeof import('../../bootstrap/hookRegistry')

async function fresh(): Promise<HookModule> {
  vi.resetModules()
  return import('../../bootstrap/hookRegistry')
}

describe('hookRegistry', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('callHook returns undefined when no hook is registered (fallback path)', async () => {
    const m = await fresh()
    expect(m.callHook('missing')).toBeUndefined()
  })

  it('calls a registered hook and returns its result', async () => {
    const m = await fresh()
    m.registerHook('double', (n: number) => n * 2)
    expect(m.callHook<number>('double', 21)).toBe(42)
  })

  it('passes all args through in order', async () => {
    const m = await fresh()
    m.registerHook('concat', (...parts: string[]) => parts.join('-'))
    expect(m.callHook<string>('concat', 'a', 'b', 'c')).toBe('a-b-c')
  })

  it('a second register of the same name overwrites the first', async () => {
    const m = await fresh()
    m.registerHook('h', () => 'first')
    m.registerHook('h', () => 'second')
    expect(m.callHook<string>('h')).toBe('second')
  })

  it('a hook that returns undefined is distinguishable only by being called', async () => {
    const m = await fresh()
    let called = false
    m.registerHook('void', () => {
      called = true
    })
    expect(m.callHook('void')).toBeUndefined()
    expect(called).toBe(true)
  })

  it('distinct hook names stay independent', async () => {
    const m = await fresh()
    m.registerHook('a', () => 1)
    m.registerHook('b', () => 2)
    expect(m.callHook<number>('a')).toBe(1)
    expect(m.callHook<number>('b')).toBe(2)
  })
})
