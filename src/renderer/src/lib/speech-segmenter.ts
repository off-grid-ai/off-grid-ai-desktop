// Streaming TTS segmenter: turn a reply that arrives token-by-token into whole
// SPEAKABLE utterances, so we can synthesize + play sentence-by-sentence as the
// model writes instead of waiting for the entire answer. Pure + stateful: feed it
// content chunks in order; it emits a segment once a sentence boundary is crossed
// (or a hard length cap is hit), and holds the trailing partial until more arrives.
// flush() emits whatever remains at end-of-turn.

export interface SegmenterOptions {
  /** Don't emit a segment shorter than this on a soft boundary — avoids choppy
   *  one-word utterances; the fragment keeps accumulating to the next boundary. */
  minChars?: number
  /** Hard cap — emit (splitting at the last space) even without a sentence end,
   *  so one very long run-on doesn't delay speech to the end of the turn. */
  maxChars?: number
}

const DEFAULTS = { minChars: 12, maxChars: 220 }

// A sentence end: . ! ? (optionally followed by a closing quote/paren), then
// whitespace or end. Also treat a newline as a boundary.
const SENTENCE_END = /[.!?]["'”’)\]]?(\s|$)/

export function createSpeechSegmenter(
  emit: (segment: string) => void,
  options: SegmenterOptions = {}
): { push: (text: string) => void; flush: () => void } {
  const minChars = options.minChars ?? DEFAULTS.minChars
  const maxChars = options.maxChars ?? DEFAULTS.maxChars
  let buf = ''

  const emitSegment = (seg: string): void => {
    const s = seg.trim()
    if (s) {
      emit(s)
    }
  }

  // The cut index of the FIRST boundary (sentence end or newline) whose resulting
  // segment is at least minChars — so a short leading fragment ("Ok.") MERGES with
  // the next sentence instead of being spoken alone. When `final`, the first
  // boundary is accepted regardless of length. -1 when no usable boundary yet.
  const findCut = (final: boolean): number => {
    let from = 0
    while (from < buf.length) {
      const rest = buf.slice(from)
      const nl = rest.indexOf('\n')
      const m = SENTENCE_END.exec(rest)
      const se = m ? m.index + m[0].length : -1
      let rel = -1
      if (nl !== -1 && (se === -1 || nl < se)) {
        rel = nl + 1
      } else if (se !== -1) {
        rel = se
      }
      if (rel === -1) {
        return -1
      }
      const cut = from + rel
      if (final || buf.slice(0, cut).trim().length >= minChars) {
        return cut
      }
      from = cut // too short — merge with the next boundary
    }
    return -1
  }

  // Emit as many complete segments as `buf` allows, leaving the trailing partial.
  const drain = (final: boolean): void => {
    for (;;) {
      const cut = findCut(final)
      if (cut !== -1) {
        emitSegment(buf.slice(0, cut))
        buf = buf.slice(cut)
        continue
      }
      // No boundary. Hard-split if past the cap, at the last space so a word isn't cut.
      if (buf.length >= maxChars) {
        const sp = buf.lastIndexOf(' ', maxChars)
        const at = sp > minChars ? sp + 1 : maxChars
        emitSegment(buf.slice(0, at))
        buf = buf.slice(at)
        continue
      }
      break
    }
  }

  return {
    push: (text: string): void => {
      buf += text
      drain(false)
    },
    flush: (): void => {
      drain(true)
      if (buf.trim()) {
        emitSegment(buf)
      }
      buf = ''
    }
  }
}
