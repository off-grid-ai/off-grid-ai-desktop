// Pure SSE streaming parse + reasoning/content split, extracted from llm.ts so the
// exact area behind a past streaming bug is unit-testable WITHOUT a socket. No
// http/fs/electron imports, no side effects beyond the caller-supplied callback.
//
// Two concerns live here:
//   1. parseSseLine - turn one raw `data:` frame line into a delta (or nothing).
//   2. createThinkSplitter - a small STATEFUL pure object that takes content text
//      chunks (which may straddle a <think>...</think> tag across chunk boundaries)
//      and emits {text, kind} events, tracking the reasoning/answer channel.

export type DeltaKind = 'content' | 'reasoning';

export interface StreamEvent {
  text: string;
  kind: DeltaKind;
}

/** Shape of a single streamed delta from the OpenAI-style chat-completions SSE. */
export interface SseDelta {
  reasoning_content?: string;
  content?: string;
}

/**
 * Parse ONE line of the SSE body. Returns the delta object when the line is a
 * usable `data:` frame, or null for anything to skip (blank line, non-data line,
 * the `[DONE]` sentinel, or an unparsable/partial frame). Mirrors the original
 * inline handling exactly: trim, require the `data:` prefix, strip it, trim, skip
 * `[DONE]`, JSON-parse, reach into choices[0].delta.
 */
export function parseSseLine(rawLine: string): SseDelta | null {
  const line = rawLine.trim();
  if (!line.startsWith('data:')) return null;
  const data = line.slice(5).trim();
  if (data === '[DONE]') return null;
  try {
    const delta = JSON.parse(data)?.choices?.[0]?.delta;
    if (delta && typeof delta === 'object') return delta as SseDelta;
    return null;
  } catch {
    // partial / ignorable line
    return null;
  }
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
  push: (text: string) => void;
  answer: () => string;
} {
  let inThink = false;
  let answer = '';

  const push = (text: string): void => {
    let rest = text;
    while (rest) {
      if (inThink) {
        const end = rest.indexOf('</think>');
        if (end === -1) { emit({ text: rest, kind: 'reasoning' }); return; }
        if (end > 0) emit({ text: rest.slice(0, end), kind: 'reasoning' });
        rest = rest.slice(end + 8); // 8 = '</think>'.length
        inThink = false;
      } else {
        const start = rest.indexOf('<think>');
        if (start === -1) { answer += rest; emit({ text: rest, kind: 'content' }); return; }
        if (start > 0) { answer += rest.slice(0, start); emit({ text: rest.slice(0, start), kind: 'content' }); }
        rest = rest.slice(start + 7); // 7 = '<think>'.length
        inThink = true;
      }
    }
  };

  return { push, answer: () => answer };
}
