// Pure search-ranking math, extracted so the ranking behaviour is unit-testable
// without the DB / Electron (mirrors model-sizing.ts). No imports, no side effects.
//
// These encode the search behaviours added this session:
//   1. Recency bias — recent hits float up (this week > last month > last quarter).
//   2. Own-content nudge — your deliberate chats / KB docs aren't buried under
//      thousands of ambient screen captures.
//   3. "Match" sort — rank by literal term overlap in title/snippet.

/** Recency boost added to a fused score. Tiered + sized to ~one rank of RRF, so a
 *  strong older match can still beat a weak recent one. No timestamp → 0. */
export function recencyBoost(ts: number, now: number): number {
  if (!ts) return 0;
  const ageDays = (now - ts) / 86_400_000;
  if (ageDays < 7) return 0.016;
  if (ageDays < 30) return 0.009;
  if (ageDays < 90) return 0.004;
  return 0;
}

/** Small visibility nudge for the user's own deliberate content (chats / KB docs). */
export function kindBoost(kind: string): number {
  return kind === 'chat' || kind === 'doc' ? 0.012 : 0;
}

/** Literal term-overlap count in a haystack (for the "Match" sort). Case-insensitive. */
export function matchScore(haystack: string, terms: string[]): number {
  const hay = (haystack || '').toLowerCase();
  return terms.reduce((n, t) => n + (t ? hay.split(t).length - 1 : 0), 0);
}
