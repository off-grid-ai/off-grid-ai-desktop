// Pure SSE streaming parse + reasoning/content split, extracted from llm.ts so the
// exact area behind a past streaming bug is unit-testable WITHOUT a socket. No
// http/fs/electron imports, no side effects beyond the caller-supplied callback.
//
// Two concerns live here:
//   1. parseSseLine - turn one raw `data:` frame line into a delta (or nothing).
//   2. createThinkSplitter - a small STATEFUL pure object that takes content text
//      chunks (which may straddle a <think>...</think> tag across chunk boundaries)
//      and emits {text, kind} events, tracking the reasoning/answer channel.

type DeltaKind = 'content' | 'reasoning'

export interface StreamEvent {
  text: string
  kind: DeltaKind
}

/** One streamed tool-call delta fragment. The first fragment for a given `index`
 *  carries `id` + `function.name`; subsequent fragments append `function.arguments`
 *  (the JSON args arrive as a concatenated string across fragments). */
export interface SseToolCallDelta {
  index: number
  id?: string
  function?: { name?: string; arguments?: string }
}

/** Shape of a single streamed delta from the OpenAI-style chat-completions SSE. */
interface SseDelta {
  reasoning_content?: string
  content?: string
  tool_calls?: SseToolCallDelta[]
}

/** One parsed OpenAI-compatible SSE choice. Finish metadata lives beside the
 * delta on the wire, so keep it beside (not inside) the streamed token shape. */
export interface SseFrame {
  delta: SseDelta
  finishReason: string | null
}

/** A fully-assembled tool call (after accumulating its streamed fragments). */
export interface AssembledToolCall {
  id: string
  name: string
  arguments: string // raw JSON string as sent by the model
}

/**
 * Accumulate streamed tool_call fragments (see SseToolCallDelta) into whole calls.
 * The model streams a tool call as: one fragment with {index, id, function.name} then
 * N fragments with {index, function.arguments:"<piece>"} that concatenate into the JSON
 * args. Keyed by `index` so parallel tool calls in one turn stay separate. Pure - feed
 * it each delta's tool_calls, then read `list()` when the round ends.
 */
export function createToolCallAccumulator(): {
  push: (deltas: SseToolCallDelta[] | undefined) => void
  list: () => AssembledToolCall[]
} {
  const byIndex = new Map<number, { id: string; name: string; args: string }>()
  const push = (deltas: SseToolCallDelta[] | undefined): void => {
    if (!deltas) return
    for (const d of deltas) {
      const cur = byIndex.get(d.index) ?? { id: '', name: '', args: '' }
      if (d.id) cur.id = d.id
      if (d.function?.name) cur.name = d.function.name
      if (d.function?.arguments) cur.args += d.function.arguments
      byIndex.set(d.index, cur)
    }
  }
  const list = (): AssembledToolCall[] =>
    [...byIndex.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([, v]) => ({ id: v.id, name: v.name, arguments: v.args }))
      .filter((c) => c.name) // drop any fragment that never got a name
  return { push, list }
}

/**
 * Parse ONE line of the SSE body. Returns the first choice when the line is a
 * usable `data:` frame, or null for anything to skip (blank line, non-data line,
 * the `[DONE]` sentinel, or an unparsable/partial frame). Mirrors the original
 * inline handling exactly: trim, require the `data:` prefix, strip it, trim, skip
 * `[DONE]`, JSON-parse, reach into choices[0]. A finish-only frame is usable even
 * when its delta is omitted because the caller needs its cutoff metadata.
 */
export function parseSseLine(rawLine: string): SseFrame | null {
  const line = rawLine.trim()
  if (!line.startsWith('data:')) return null
  const data = line.slice(5).trim()
  if (data === '[DONE]') return null
  try {
    const choice = JSON.parse(data)?.choices?.[0]
    if (!choice || typeof choice !== 'object') return null
    const delta = choice.delta
    const finishReason = typeof choice.finish_reason === 'string' ? choice.finish_reason : null
    if (delta && typeof delta === 'object') {
      return { delta: delta as SseDelta, finishReason }
    }
    if (finishReason) return { delta: {}, finishReason }
    return null
  } catch {
    // partial / ignorable line
    return null
  }
}

/**
 * Stateful filter that suppresses tool-call MARKUP from the visible content stream.
 * Small models (gemma-4/qwen) sometimes emit a tool call as text — `<tool_call>{…}`,
 * `<|tool_call|>…`, `<invoke …>` — which the loop recovers (see tool-call-parse),
 * but the raw markup would otherwise flash in the user's answer before the tool
 * runs. Once an opener is seen, everything after it is dropped from the visible
 * stream for the rest of the turn (the tool call IS the tail of the content). It
 * only filters what the USER SEES — the caller still keeps the full text for
 * parsing. Straddle-safe: holds back a short trailing tail that could be the start
 * of an opener across chunk boundaries; `end()` flushes it if it wasn't one.
 *
 * Pure: the only side effect is the caller-supplied `emit`.
 */
export function createToolMarkupFilter(emit: (text: string) => void): {
  push: (text: string) => void
  end: () => void
} {
  const OPENER = /<\|?tool_call\|?>?|<invoke\b/i
  const OPENER_PREFIXES = ['<tool_call', '<|tool_call', '<invoke']
  let suppressing = false
  let pending = ''

  // The earliest index of a '<' from which the tail is a PARTIAL prefix of a known
  // opener (so it might complete into one on the next chunk). -1 when no such tail
  // exists — i.e. normal content that should stream now, at full granularity.
  const partialOpenerAt = (s: string): number => {
    for (let i = 0; i < s.length; i++) {
      if (s[i] !== '<') {
        continue
      }
      const tail = s.slice(i).toLowerCase()
      if (OPENER_PREFIXES.some((p) => p.startsWith(tail))) {
        return i
      }
    }
    return -1
  }

  const push = (text: string): void => {
    if (suppressing) {
      return
    }
    pending += text
    const m = OPENER.exec(pending)
    if (m) {
      if (m.index > 0) {
        emit(pending.slice(0, m.index))
      }
      suppressing = true
      pending = ''
      return
    }
    // No full opener. Hold back ONLY a trailing tail that could still become one;
    // everything before it streams immediately (preserves per-token granularity).
    const hold = partialOpenerAt(pending)
    if (hold === -1) {
      if (pending) {
        emit(pending)
      }
      pending = ''
    } else {
      if (hold > 0) {
        emit(pending.slice(0, hold))
      }
      pending = pending.slice(hold)
    }
  }
  const end = (): void => {
    if (!suppressing && pending) {
      emit(pending)
    }
    pending = ''
  }
  return { push, end }
}

/**
 * Stateful splitter for models that inline <think>...</think> reasoning inside the
 * `content` channel. Feed it content chunks in order; it emits reasoning vs content
 * events and carries the in-think state across chunk boundaries (open tag in one
 * chunk, close in the next). It also accumulates the ANSWER text only (reasoning is
 * excluded) so the caller can resolve the final answer - matching the original
 * `full` accumulator in chatStream.
 *
 * Pure: the only side effect is invoking the caller-supplied `emit` callback.
 */
export function createThinkSplitter(emit: (ev: StreamEvent) => void): {
  push: (text: string) => void
  answer: () => string
} {
  let inThink = false
  let answer = ''

  const push = (text: string): void => {
    let rest = text
    while (rest) {
      if (inThink) {
        const end = rest.indexOf('</think>')
        if (end === -1) {
          emit({ text: rest, kind: 'reasoning' })
          return
        }
        if (end > 0) emit({ text: rest.slice(0, end), kind: 'reasoning' })
        rest = rest.slice(end + 8) // 8 = '</think>'.length
        inThink = false
      } else {
        const start = rest.indexOf('<think>')
        if (start === -1) {
          answer += rest
          emit({ text: rest, kind: 'content' })
          return
        }
        if (start > 0) {
          answer += rest.slice(0, start)
          emit({ text: rest.slice(0, start), kind: 'content' })
        }
        rest = rest.slice(start + 7) // 7 = '<think>'.length
        inThink = true
      }
    }
  }

  return { push, answer: () => answer }
}
