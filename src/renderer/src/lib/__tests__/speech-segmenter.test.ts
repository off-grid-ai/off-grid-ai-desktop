/**
 * The streaming-TTS segmenter: turns token-by-token content into whole speakable
 * sentences so speech can start while the model is still writing. Real streaming
 * inputs (chunks that straddle sentence boundaries); asserts the emitted segments.
 */
import { describe, it, expect } from 'vitest'
import { createSpeechSegmenter } from '../speech-segmenter'

function collect(opts?: { minChars?: number; maxChars?: number }): {
  push: (t: string) => void
  flush: () => void
  segs: string[]
} {
  const segs: string[] = []
  const s = createSpeechSegmenter((seg) => segs.push(seg), opts)
  return { push: s.push, flush: s.flush, segs }
}

describe('createSpeechSegmenter', () => {
  it('emits a segment once a sentence boundary is crossed, holding the partial', () => {
    const c = collect()
    c.push('Hello there, this is fine. And the sec')
    expect(c.segs).toEqual(['Hello there, this is fine.']) // first sentence out, rest held
    c.push('ond one is here too. ')
    expect(c.segs).toEqual(['Hello there, this is fine.', 'And the second one is here too.'])
  })

  it('reassembles a sentence that streams across many tiny chunks', () => {
    const c = collect()
    for (const ch of 'The quick brown fox jumps. ') {
      c.push(ch)
    }
    expect(c.segs).toEqual(['The quick brown fox jumps.'])
  })

  it('treats a newline as a boundary', () => {
    const c = collect()
    c.push('First line here\nSecond line here\n')
    expect(c.segs).toEqual(['First line here', 'Second line here'])
  })

  it('holds a too-short fragment until the next boundary (no choppy one-word speech)', () => {
    const c = collect({ minChars: 12 })
    c.push('Ok. ') // shorter than minChars → held
    expect(c.segs).toEqual([])
    c.push('Now here is a real sentence. ')
    expect(c.segs).toEqual(['Ok. Now here is a real sentence.'])
  })

  it('hard-splits a run-on past the max cap at a word boundary', () => {
    const c = collect({ maxChars: 30 })
    c.push('word '.repeat(20)) // 100 chars, no sentence end
    // Something was emitted (didn't wait for the whole run-on), split on spaces.
    expect(c.segs.length).toBeGreaterThan(0)
    expect(c.segs.every((s) => !s.includes('  '))).toBe(true)
  })

  it('flush emits the trailing partial even without a sentence end', () => {
    const c = collect()
    c.push('a final thought with no period')
    expect(c.segs).toEqual([])
    c.flush()
    expect(c.segs).toEqual(['a final thought with no period'])
  })

  it('emits nothing for empty/whitespace and never emits blank segments', () => {
    const c = collect()
    c.push('   \n  ')
    c.flush()
    expect(c.segs).toEqual([])
  })
})
