/**
 * Guard: EVERY message -> speech / transcript path goes through one helper
 * (messageToSpeakable -> shared toSpeakableText), so no path can leak raw markdown to
 * the TTS engine or the on-screen transcript. Regression: voice-mode VoiceBubble spoke
 * and displayed literal asterisks because only the Speak button was cleaned.
 * MemoryChat.tsx is coverage-excluded, so guard the contract by reading the source (§D).
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

const src = readFileSync(join(__dirname, '../MemoryChat.tsx'), 'utf8')

describe('MemoryChat — one speakable derivation for all TTS/transcript paths', () => {
  it('defines messageToSpeakable on top of the shared toSpeakableText', () => {
    expect(src).toMatch(/function messageToSpeakable/)
    expect(src).toMatch(/messageToSpeakable[\s\S]{0,240}toSpeakableText\(/)
  })

  it('the Speak button synthesizes messageToSpeakable(...), not raw text', () => {
    expect(src).toMatch(/window\.api\.speak\(messageToSpeakable\(/)
  })

  it('voice-mode transcripts use messageToSpeakable(...), never raw message.content', () => {
    expect(src).toMatch(/const transcript = messageToSpeakable\(/)
    expect(src).toMatch(/transcript=\{messageToSpeakable\(message\.content\)\}/)
    // No VoiceBubble may be handed the raw, un-stripped message content.
    expect(src).not.toMatch(/transcript=\{message\.content\}/)
  })
})
