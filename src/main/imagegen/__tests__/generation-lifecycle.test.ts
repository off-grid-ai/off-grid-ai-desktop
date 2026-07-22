import { describe, expect, it } from 'vitest'
import { IMAGE_CANCELLED_MESSAGE, ImageGenerationLifecycle } from '../generation-lifecycle'

describe('ImageGenerationLifecycle', () => {
  it('cancels memory reclamation before a native runtime can launch', async () => {
    const lifecycle = new ImageGenerationLifecycle()
    lifecycle.start()
    const reclaim = lifecycle.waitForMemoryReclaim(2500, 5)

    expect(lifecycle.cancel()).toBe(true)
    await expect(reclaim).rejects.toThrow(IMAGE_CANCELLED_MESSAGE)
    expect(lifecycle.isCancelled()).toBe(true)
  })

  it('rejects overlapping generations and returns to idle after finish', () => {
    const lifecycle = new ImageGenerationLifecycle()
    expect(lifecycle.cancel()).toBe(false)
    lifecycle.start()
    expect(() => lifecycle.start()).toThrow('An image is already generating')
    lifecycle.finish()
    expect(lifecycle.isRunning()).toBe(false)
  })
})
