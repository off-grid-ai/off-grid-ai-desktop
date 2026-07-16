// Edge-branch coverage for the energy VAD - the empty-buffer guards that vad.test.ts
// (which uses non-empty tones/silence) never reaches. rms, isSpeech, and speechRatio
// must all no-op safely on a zero-length block, and speechRatio must handle the
// frame-loop producing zero frames.
import { describe, it, expect } from 'vitest'
import { rms, isSpeech, speechRatio, DEFAULT_SPEECH_RMS } from '../vad'

const EMPTY = new Float32Array(0)

describe('vad empty-buffer guards', () => {
  it('rms returns 0 for a zero-length block (guard branch)', () => {
    expect(rms(EMPTY)).toBe(0)
  })

  it('isSpeech is false for a zero-length block (rms 0 < gate)', () => {
    expect(isSpeech(EMPTY)).toBe(false)
  })

  it('speechRatio returns 0 for a zero-length block (no frames)', () => {
    expect(speechRatio(EMPTY)).toBe(0)
  })

  it('speechRatio yields 1 when a single short frame clears the gate', () => {
    // Fewer samples than the default frameSize -> exactly one frame, and it is loud.
    const loud = new Float32Array(400).fill(0.5)
    expect(speechRatio(loud)).toBe(1)
  })

  it('honours a custom threshold that rejects an otherwise-passing block', () => {
    const quiet = new Float32Array(1600).fill(0.01) // rms 0.01
    expect(isSpeech(quiet, DEFAULT_SPEECH_RMS)).toBe(true) // 0.01 >= 0.008
    expect(isSpeech(quiet, 0.05)).toBe(false) // raised gate rejects it
  })
})
