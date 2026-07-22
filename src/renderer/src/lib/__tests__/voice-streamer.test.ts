/**
 * The per-turn voice streamer: content tokens in → spoken sentences out, in order,
 * while the reply is still streaming. Composes the real segmenter + queue; only
 * synthesize/play/clean are faked at the boundary. Asserts the end-to-end behavior
 * the user hears: sentences are spoken as they complete, cleaned of markdown, the
 * trailing partial speaks on finish, and stop() halts speech.
 */
import { describe, it, expect } from 'vitest'

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

async function drain(spoken: string[], expected: number): Promise<void> {
  for (let i = 0; i < 20 && spoken.length < expected; i++) {
    await tick()
  }
}

describe('createVoiceStreamer', () => {
  it('speaks each sentence as it completes, cleaned, in order', async () => {
    const spoken: string[] = []
    const { createVoiceStreamer } = await import('../voice-streamer')
    const vs = createVoiceStreamer({
      synthesize: async (t) => ({ dataUrl: `url:${t}` }),
      play: async (url) => {
        spoken.push(url.replace('url:', ''))
      },
      clean: (t) => t.replace(/\*\*/g, '') // pretend markdown strip
    })

    vs.feed('s1', 'This is the **first** sentence. And the sec')
    await drain(spoken, 1)
    expect(spoken).toEqual(['This is the first sentence.']) // markdown stripped, spoken already

    vs.feed('s1', 'ond one arrives. ')
    await drain(spoken, 2)
    expect(spoken).toEqual(['This is the first sentence.', 'And the second one arrives.'])
  })

  it('speaks the trailing partial only after finish()', async () => {
    const spoken: string[] = []
    const { createVoiceStreamer } = await import('../voice-streamer')
    const vs = createVoiceStreamer({
      synthesize: async (t) => ({ dataUrl: t }),
      play: async (url) => {
        spoken.push(url)
      },
      clean: (t) => t
    })
    vs.feed('s1', 'a closing thought with no period')
    await drain(spoken, 1)
    expect(spoken).toEqual([]) // no boundary yet
    vs.finish('s1')
    await drain(spoken, 1)
    expect(spoken).toEqual(['a closing thought with no period'])
  })

  it('a new streamId starts a fresh session (stops the previous)', async () => {
    const played: string[] = []
    const { createVoiceStreamer } = await import('../voice-streamer')
    const vs = createVoiceStreamer({
      synthesize: async (t) => ({ dataUrl: t }),
      play: async (url, signal) => {
        played.push(url)
        await new Promise<void>((res) => signal.addEventListener('abort', () => res()))
      },
      clean: (t) => t
    })
    vs.feed('s1', 'Old turn one. Old turn two. ')
    await tick()
    vs.feed('s2', 'New turn. ') // new stream → previous stopped
    await tick()
    // The second stream's queue is independent; the first was aborted.
    expect(played[0]).toBe('Old turn one.')
  })

  it('stop() halts speech (barge-in)', async () => {
    const started: string[] = []
    const { createVoiceStreamer } = await import('../voice-streamer')
    const vs = createVoiceStreamer({
      synthesize: async (t) => ({ dataUrl: t }),
      play: async (url, signal) => {
        started.push(url)
        await new Promise<void>((res) => signal.addEventListener('abort', () => res()))
      },
      clean: (t) => t
    })
    vs.feed(
      's1',
      'This is the first full sentence. This is the second full sentence. This is the third full sentence. '
    )
    await tick()
    expect(started).toEqual(['This is the first full sentence.']) // first playing, rest queued
    vs.stop()
    await tick()
    await tick()
    expect(started).toEqual(['This is the first full sentence.']) // rest cleared, never played
  })

  it('a failed synthesis is skipped without stopping the rest', async () => {
    const spoken: string[] = []
    const { createVoiceStreamer } = await import('../voice-streamer')
    const vs = createVoiceStreamer({
      synthesize: async (t) => {
        if (t.includes('bad')) {
          throw new Error('synth down')
        }
        return { dataUrl: t }
      },
      play: async (url) => {
        spoken.push(url)
      },
      clean: (t) => t
    })
    vs.feed('s1', 'Good one here. This is bad now. Good three here. ')
    await drain(spoken, 2)
    expect(spoken).toEqual(['Good one here.', 'Good three here.'])
  })
})
