// Pure TTS helpers extracted from tts.ts so they can be unit-tested without
// spawning the Kokoro worker or loading electron. Behaviour is unchanged —
// tts.ts imports these back and uses them exactly as before.

export const DEFAULT_VOICE = 'af_heart'

/** Pick the voice to synthesize with. Caller's explicit `voice` wins; else the
 *  user-selected speech voice IF it looks like a real voice name (e.g. "af_heart")
 *  and not a model id; else the default. Guards against feeding the engine an
 *  invalid voice when a model was picked in the UI. */
export function chooseVoice(voice: string | undefined, sel: string | null | undefined): string {
  return voice || (sel && /^[a-z]{2}_[a-z]+$/i.test(sel) ? sel : null) || DEFAULT_VOICE
}

/** onnxruntime's harmless teardown crash — not a real failure if output exists. */
export function isTeardownNoise(err: string): boolean {
  return /mutex lock failed|Session already disposed|libc\+\+abi/i.test(err)
}

export interface ServeMsg {
  ready?: boolean
  id?: string
  ok?: boolean
  error?: string
}

/** Parse one NDJSON line from the resident worker's stdout. A blank line (after
 *  trim) or malformed JSON yields null — the caller skips it. */
export function parseServeLine(line: string): ServeMsg | null {
  const trimmed = line.trim()
  if (!trimmed) return null
  try {
    return JSON.parse(trimmed) as ServeMsg
  } catch {
    return null
  }
}
