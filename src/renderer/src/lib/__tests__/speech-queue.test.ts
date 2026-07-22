/**
 * The streaming-TTS playback queue: synthesize + play segments strictly in order,
 * one at a time, with stop() for barge-in. Deps (synthesize/play) are faked at the
 * boundary; the ordering, sequencing, skip-on-error, and abort behavior are real.
 */
import { describe, it, expect, vi } from 'vitest'
import { createSpeechQueue } from '../speech-queue'

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

describe('createSpeechQueue', () => {
  it('plays enqueued segments strictly in order, one at a time', async () => {
    const events: string[] = []
    const q = createSpeechQueue({
      synthesize: async (t) => ({ dataUrl: `url:${t}` }),
      play: async (url) => {
        events.push(`play-start:${url}`)
        await tick()
        events.push(`play-end:${url}`)
      }
    })
    q.enqueue('one')
    q.enqueue('two')
    // Wait for both to drain.
    for (let i = 0; i < 10 && q.isActive(); i++) {
      await tick()
    }
    // Strict order: 'two' never starts before 'one' finishes.
    expect(events).toEqual([
      'play-start:url:one',
      'play-end:url:one',
      'play-start:url:two',
      'play-end:url:two'
    ])
  })

  it('stop() halts playback and clears anything pending (barge-in)', async () => {
    const played: string[] = []
    let releaseFirst!: () => void
    const q = createSpeechQueue({
      synthesize: async (t) => ({ dataUrl: t }),
      play: async (url, signal) => {
        played.push(url)
        await new Promise<void>((resolve) => {
          releaseFirst = resolve
          signal.addEventListener('abort', () => resolve())
        })
      }
    })
    q.enqueue('a')
    q.enqueue('b')
    q.enqueue('c')
    await tick()
    expect(played).toEqual(['a']) // only the first is playing
    q.stop() // barge-in
    releaseFirst()
    await tick()
    await tick()
    expect(played).toEqual(['a']) // b and c were cleared, never played
    expect(q.isActive()).toBe(false)
  })

  it('skips a segment that fails to synthesize without stopping the rest', async () => {
    const played: string[] = []
    const q = createSpeechQueue({
      synthesize: async (t) => {
        if (t === 'bad') {
          throw new Error('synth failed')
        }
        return { dataUrl: t }
      },
      play: async (url) => {
        played.push(url)
      }
    })
    q.enqueue('good1')
    q.enqueue('bad')
    q.enqueue('good2')
    for (let i = 0; i < 10 && q.isActive(); i++) {
      await tick()
    }
    expect(played).toEqual(['good1', 'good2']) // bad skipped, good2 still played
  })

  it('calls onIdle when the queue drains', async () => {
    const onIdle = vi.fn()
    const q = createSpeechQueue({
      synthesize: async (t) => ({ dataUrl: t }),
      play: async () => {},
      onIdle
    })
    q.enqueue('x')
    for (let i = 0; i < 10 && q.isActive(); i++) {
      await tick()
    }
    expect(onIdle).toHaveBeenCalled()
  })
})
