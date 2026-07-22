// D34 — an optimistic toggle must revert if its persist fails, so it never shows a
// value the backend didn't save. persistToggle is the shared primitive; its
// observable contract is the sequence of `apply` calls (apply IS the injected UI
// effect, so this is the function's output, not a mock of our own feature code).

import { describe, it, expect, vi } from 'vitest'
import { persistToggle } from '../persist-toggle'

describe('persistToggle (D34)', () => {
  it('applies the new value optimistically and keeps it when the persist succeeds', async () => {
    const apply = vi.fn<(v: boolean) => void>()
    await persistToggle(true, false, apply, async () => {})
    expect(apply.mock.calls.map((c) => c[0])).toEqual([true]) // applied next, no revert
  })

  it('reverts to the previous value when the persist REJECTS', async () => {
    const apply = vi.fn<(v: boolean) => void>()
    await persistToggle(true, false, apply, async () => {
      throw new Error('db locked')
    })
    // Optimistic apply(true), then revert to apply(false) — the UI ends on the saved value.
    expect(apply.mock.calls.map((c) => c[0])).toEqual([true, false])
  })

  it('does not reject even if the persist throws (best-effort UI)', async () => {
    const apply = vi.fn<(v: string) => void>()
    await expect(
      persistToggle('a', 'b', apply, () => {
        throw new Error('sync throw')
      })
    ).resolves.toBeUndefined()
    expect(apply.mock.calls.map((c) => c[0])).toEqual(['a', 'b'])
  })
})
