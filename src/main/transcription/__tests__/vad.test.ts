import { describe, it, expect } from 'vitest'
import { rms, isSpeech, speechRatio, DEFAULT_SPEECH_RMS } from '../vad'

function tone(n: number, amp: number): Float32Array {
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) out[i] = Math.sin(i / 4) * amp
  return out
}

describe('vad', () => {
  it('rms of silence is 0', () => {
    expect(rms(new Float32Array(1000))).toBe(0)
  })

  it('rms grows with amplitude', () => {
    expect(rms(tone(1000, 0.5))).toBeGreaterThan(rms(tone(1000, 0.05)))
  })

  it('isSpeech rejects silence and near-silence', () => {
    expect(isSpeech(new Float32Array(1600))).toBe(false)
    expect(isSpeech(tone(1600, 0.001))).toBe(false)
  })

  it('isSpeech accepts a clear tone above the gate', () => {
    expect(isSpeech(tone(1600, 0.3))).toBe(true)
  })

  it('speechRatio is ~0 for silence and ~1 for a sustained tone', () => {
    expect(speechRatio(new Float32Array(16000))).toBe(0)
    expect(speechRatio(tone(16000, 0.3))).toBeGreaterThan(0.9)
  })

  it('default gate sits between room tone and quiet speech', () => {
    expect(DEFAULT_SPEECH_RMS).toBeGreaterThan(0.001)
    expect(DEFAULT_SPEECH_RMS).toBeLessThan(0.05)
  })
})
