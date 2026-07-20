// Pure TTS helpers extracted from tts.ts so they can be unit-tested without
// spawning the Kokoro worker or loading electron. Behaviour is unchanged —
// tts.ts imports these back and uses them exactly as before.

export const DEFAULT_VOICE = 'af_heart'

/** Convert rendered assistant markdown into the plain text the speech engine should
 * pronounce. Keep the meaningful label/content while removing formatting tokens,
 * destinations, and HTML that would otherwise be read aloud as syntax. */
export function toSpeakableText(markdown: string): string {
  return (markdown || '')
    .replace(/```[^\n]*\n?([\s\S]*?)```/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/^[ \t]{0,3}(?:[-*_][ \t]*){3,}$/gm, '')
    .replace(/^[ \t]{0,3}(?:#{1,6}|>|[-+*]|\d+[.)])[ \t]+/gm, '')
    .replace(/(\*\*|__|~~)(.*?)\1/g, '$2')
    // Single emphasis: strip the delimiters but keep the word. The boundary is any
    // non-word char (not just whitespace/paren) so emphasis attached to an em dash,
    // quote, or bracket — e.g. `asking—*are you here*,` — is caught too. `[^\w*]`
    // excludes letters/digits/underscore, so `release_candidate` and intraword `*`
    // (`2 * 3` keeps its spaced operator via the `(?=\S)` guard) are left intact.
    .replace(/(^|[^\w*])([*_])(?=\S)([^*_\n]*?\S)\2(?=$|[^\w*])/gm, '$1$3')
    .replace(/`([^`\n]+)`/g, '$1')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

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
