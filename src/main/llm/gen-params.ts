// Shared precedence rules for a generation's parameters, defined ONCE so the
// chat entry points (chat / chatStream / streamChat) can't diverge. Pure + zero-IO
// so it's unit-tested directly.

/** max_tokens for a call: an explicit per-call request wins; otherwise the user's
 *  persisted setting. chatStream once used `setting || requested`, which made the
 *  caller's value DEAD (the setting is always truthy) — a streamed answer was
 *  capped at the setting no matter what the turn asked for (D10). This makes the
 *  requested value authoritative when given, with the setting as the fallback. */
export function resolveMaxTokens(requested: number | undefined, setting: number): number {
  return requested ?? setting;
}
