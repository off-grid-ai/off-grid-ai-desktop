import { describe, expect, it, vi } from 'vitest'
import { writeClipboardWithFallback } from '../clipboard-write'

describe('writeClipboardWithFallback', () => {
  it('uses the Electron bridge when its native write succeeds', async () => {
    const bridge = vi.fn(async () => true)
    const browser = vi.fn(async () => undefined)

    await expect(writeClipboardWithFallback('copied text', bridge, browser)).resolves.toBe(true)
    expect(browser).not.toHaveBeenCalled()
  })

  it.each([
    ['reports failure', vi.fn(async () => false)],
    ['rejects', vi.fn(async () => Promise.reject(new Error('IPC unavailable')))]
  ])('uses the browser clipboard when the Electron bridge %s', async (_case, bridge) => {
    const browser = vi.fn(async () => undefined)

    await expect(writeClipboardWithFallback('copied text', bridge, browser)).resolves.toBe(true)
    expect(browser).toHaveBeenCalledWith('copied text')
  })

  it('reports failure without leaking a rejection when both clipboard boundaries fail', async () => {
    const bridge = vi.fn(async () => Promise.reject(new Error('IPC unavailable')))
    const browser = vi.fn(async () => Promise.reject(new Error('permission denied')))

    await expect(writeClipboardWithFallback('copied text', bridge, browser)).resolves.toBe(false)
  })
})
