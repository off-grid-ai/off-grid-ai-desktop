// D26 — "Configure for me" never activated TTS. autoConfigure passes the setup
// vocab kind 'voice' to setActiveModalChoice, but that function gated on
// isModalKind, which accepts only 'speech'/'image'/'transcription' — so the 'voice'
// call returned { success: false } (swallowed) and Kokoro was never set active.
//
// The fix normalizes the kind through modalityForModel (the single dispatch, now
// idempotent on 'speech'), so both the setup 'voice' and the dispatched 'speech'
// activate TTS. This is a source-contract guard that the buggy gate can't return:
// setActiveModalChoice no longer branches on isModalKind and normalizes instead.
// (The full "run Configure-for-me → Kokoro shows Active" flow is the on-device
// check in DEVICE_TEST_LOG — setActiveModalChoice sits behind the heavy llm import.)

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

const src = readFileSync(join(__dirname, '..', '..', 'models-manager.ts'), 'utf8')
const fn = src.slice(
  src.indexOf('export async function setActiveModalChoice'),
  src.indexOf('export function getActiveModalities')
)

describe('setActiveModalChoice normalizes the modality (D26)', () => {
  it('no longer gates on isModalKind (which rejected the setup "voice" kind)', () => {
    expect(fn).not.toMatch(/isModalKind\(/)
  })

  it('normalizes the kind through modalityForModel so voice + speech both activate', () => {
    expect(fn).toMatch(/modalityForModel\(kind\)/)
  })
})
