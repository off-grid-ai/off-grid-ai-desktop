// Shared precedence rules for a generation's parameters, defined ONCE so the
// chat entry points (chat / chatStream / streamChat) can't diverge. Pure + zero-IO
// so it's unit-tested directly.

/** max_tokens for a call: an explicit per-call request wins; otherwise the user's
 *  persisted setting. chatStream once used `setting || requested`, which made the
 *  caller's value DEAD (the setting is always truthy) — a streamed answer was
 *  capped at the setting no matter what the turn asked for (D10). This makes the
 *  requested value authoritative when given, with the setting as the fallback. */
export function resolveMaxTokens(requested: number | undefined, setting: number): number {
  return requested ?? setting
}

// Re-exported from the shared defaults so main + renderer agree on the "auto" sentinel (0).
export { MAX_TOKENS_AUTO } from '../../shared/llm-defaults'

/** Convert a resolved max-output value to what llama-server expects: a positive number is a hard
 *  cap; auto (<= 0) becomes n_predict = -1 (generate until EOS / the window is exhausted). This is
 *  why max output is no longer the limiting factor — context is. */
export function maxTokensForWire(resolved: number): number {
  return resolved > 0 ? resolved : -1
}
