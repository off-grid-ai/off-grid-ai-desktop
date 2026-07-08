/**
 * Regression tests for unified-search RANKING behaviour added this session:
 *   - recency bias (this week > last month > last quarter > older)
 *   - own-content nudge so chats / KB docs aren't buried under ambient captures
 *   - "Match" sort = literal term overlap
 * Pure math (no DB/Electron), mirroring model-sizing.test.ts.
 */
import { describe, it, expect } from 'vitest';
import {
  recencyBoost,
  kindBoost,
  matchScore,
  queryTerms,
  ftsExpr,
  rrf,
  fuseHits,
  applyBoosts,
  rankResults,
  type RawHit,
} from '../search-ranking';

const DAY = 86_400_000;
const NOW = 1_800_000_000_000; // fixed "now" so tests are deterministic

// A minimal RawHit for fusion tests. Overrides win over the defaults.
function hit(over: Partial<RawHit> & { key: string }): RawHit {
  return {
    kind: 'screen',
    refId: 1,
    title: 'Title',
    snippet: 'Snippet',
    surface: 'Screen',
    url: null,
    ts: 0,
    ...over,
  };
}

describe('recencyBoost — recent first, tiered', () => {
  it('this week beats last month beats last quarter beats older', () => {
    const week = recencyBoost(NOW - 3 * DAY, NOW);
    const month = recencyBoost(NOW - 20 * DAY, NOW);
    const quarter = recencyBoost(NOW - 60 * DAY, NOW);
    const older = recencyBoost(NOW - 200 * DAY, NOW);
    expect(week).toBeGreaterThan(month);
    expect(month).toBeGreaterThan(quarter);
    expect(quarter).toBeGreaterThan(older);
    expect(older).toBe(0);
  });

  it('no timestamp → no boost', () => {
    expect(recencyBoost(0, NOW)).toBe(0);
  });

  it('boost stays within ~one RRF rank (does not dominate)', () => {
    // RRF top rank ≈ 1/60 ≈ 0.0167; the freshest boost must not exceed it, so a
    // strong older multi-list match can still outrank a weak recent one.
    expect(recencyBoost(NOW, NOW)).toBeLessThanOrEqual(1 / 60);
  });
});

describe('kindBoost — own deliberate content surfaces', () => {
  it('chats and KB docs get a nudge; ambient kinds do not', () => {
    expect(kindBoost('chat')).toBeGreaterThan(0);
    expect(kindBoost('doc')).toBeGreaterThan(0);
    expect(kindBoost('screen')).toBe(0);
    expect(kindBoost('meeting')).toBe(0);
    expect(kindBoost('entity')).toBe(0);
  });

  it('a fresh chat outranks an equally-ranked ambient screen capture', () => {
    const base = 1 / 60; // both matched once
    const chat = base + recencyBoost(NOW - 1 * DAY, NOW) + kindBoost('chat');
    const screen = base + recencyBoost(NOW - 1 * DAY, NOW) + kindBoost('screen');
    expect(chat).toBeGreaterThan(screen);
  });
});

describe('matchScore — literal term overlap for the Match sort', () => {
  it('counts occurrences of each term, case-insensitive', () => {
    expect(matchScore('Praveen and Mac, Praveen again', ['praveen'])).toBe(2);
    expect(matchScore('Off Grid sync plan', ['off', 'grid'])).toBe(2);
  });

  it('ranks a denser match above a sparse one', () => {
    const terms = ['off', 'grid'];
    const dense = matchScore('Off Grid — Off Grid roadmap', terms);
    const sparse = matchScore('a grid of icons', terms);
    expect(dense).toBeGreaterThan(sparse);
  });

  it('no terms / empty haystack → 0', () => {
    expect(matchScore('anything', [])).toBe(0);
    expect(matchScore('', ['x'])).toBe(0);
  });
});

describe('queryTerms — the single tokeniser', () => {
  it('lowercases, splits on punctuation/whitespace, drops symbols', () => {
    expect(queryTerms('Off-Grid  SYNC, plan!', 12)).toEqual(['off', 'grid', 'sync', 'plan']);
  });

  it('keeps unicode letters and digits', () => {
    expect(queryTerms('café 2024 déjà', 12)).toEqual(['café', '2024', 'déjà']);
  });

  it('caps at max terms', () => {
    expect(queryTerms('a b c d e', 3)).toEqual(['a', 'b', 'c']);
  });

  it('a punctuation-only / empty query yields no terms', () => {
    expect(queryTerms('   ---  ', 12)).toEqual([]);
    expect(queryTerms('', 6)).toEqual([]);
  });
});

describe('ftsExpr — FTS5 prefix-match expression', () => {
  it('wraps each of up to 12 tokens as a quoted prefix term', () => {
    expect(ftsExpr('off grid')).toBe('"off"* "grid"*');
  });

  it('drops punctuation so user input can never be an FTS syntax error', () => {
    // A bare quote / paren would break MATCH; tokenising strips it.
    expect(ftsExpr('a"b (c)')).toBe('"a"* "b"* "c"*');
  });

  it('caps at 12 terms', () => {
    const q = Array.from({ length: 20 }, (_, i) => `t${i}`).join(' ');
    expect(ftsExpr(q).split(' ').length).toBe(12);
  });

  it('empty / symbol-only query → empty match (callers treat as no keyword pass)', () => {
    expect(ftsExpr('')).toBe('');
    expect(ftsExpr('***')).toBe('');
  });
});

describe('rrf — reciprocal-rank fusion weight', () => {
  it('rank 0 is the strongest and weights decay with rank', () => {
    expect(rrf(0)).toBeCloseTo(1 / 60);
    expect(rrf(0)).toBeGreaterThan(rrf(1));
    expect(rrf(1)).toBeGreaterThan(rrf(9));
  });
});

describe('fuseHits — RRF fusion + dedupe by key', () => {
  it('a key in two lists accumulates both lists’ rrf weights', () => {
    const a: RawHit[] = [hit({ key: 'obs:1' }), hit({ key: 'obs:2' })];
    const b: RawHit[] = [hit({ key: 'obs:2' }), hit({ key: 'obs:3' })];
    const fused = fuseHits([a, b]);
    // obs:2 = rank1 in a (rrf 1) + rank0 in b (rrf 0)  -> two contributions.
    expect(fused.get('obs:2')!.score).toBeCloseTo(rrf(1) + rrf(0));
    expect(fused.get('obs:1')!.score).toBeCloseTo(rrf(0));
    expect(fused.get('obs:3')!.score).toBeCloseTo(rrf(1));
    expect(fused.size).toBe(3);
  });

  it('an item ranked high in two lists beats one ranked high in only one', () => {
    const a: RawHit[] = [hit({ key: 'both' }), hit({ key: 'solo' })];
    const b: RawHit[] = [hit({ key: 'both' })];
    const fused = fuseHits([a, b]);
    expect(fused.get('both')!.score).toBeGreaterThan(fused.get('solo')!.score);
  });

  it('the first list a key appears in seeds its shape; later lists only add score', () => {
    const a: RawHit[] = [hit({ key: 'k', title: 'FIRST', snippet: 'first snippet', surface: 'A' })];
    const b: RawHit[] = [hit({ key: 'k', title: 'SECOND', snippet: 'second snippet', surface: 'B' })];
    const fused = fuseHits([a, b]);
    const r = fused.get('k')!;
    expect(r.title).toBe('FIRST');
    expect(r.snippet).toBe('first snippet');
    expect(r.surface).toBe('A');
  });

  it('caps snippet at 280 chars and falls back title/surface/ts when blank', () => {
    const long = 'x'.repeat(400);
    const fused = fuseHits([[hit({ key: 'k', kind: 'memory', title: '', snippet: long, surface: '', ts: 0 })]]);
    const r = fused.get('k')!;
    expect(r.snippet.length).toBe(280);
    expect(r.title).toBe('memory'); // empty title → kind
    expect(r.surface).toBe('');
    expect(r.ts).toBe(0);
    expect(r.imagePath).toBeNull();
  });

  it('empty input → empty map; disjoint lists keep every key once', () => {
    expect(fuseHits([]).size).toBe(0);
    expect(fuseHits([[], []]).size).toBe(0);
    const fused = fuseHits([[hit({ key: 'a' })], [hit({ key: 'b' })]]);
    expect([...fused.keys()].sort()).toEqual(['a', 'b']);
  });

  it('a single source still fuses (scores follow rank order)', () => {
    const fused = fuseHits([[hit({ key: 'a' }), hit({ key: 'b' }), hit({ key: 'c' })]]);
    expect(fused.get('a')!.score).toBeGreaterThan(fused.get('b')!.score);
    expect(fused.get('b')!.score).toBeGreaterThan(fused.get('c')!.score);
  });
});

describe('applyBoosts — recency + own-content nudge in place', () => {
  it('adds the recency and kind boosts to each result score', () => {
    const fused = fuseHits([[hit({ key: 'chat:1', kind: 'chat', ts: NOW - 1 * DAY })]]);
    const before = fused.get('chat:1')!.score;
    applyBoosts(fused.values(), NOW);
    expect(fused.get('chat:1')!.score).toBeCloseTo(before + recencyBoost(NOW - 1 * DAY, NOW) + kindBoost('chat'));
  });

  it('a screen capture with no timestamp gets no boost', () => {
    const fused = fuseHits([[hit({ key: 'obs:1', kind: 'screen', ts: 0 })]]);
    const before = fused.get('obs:1')!.score;
    applyBoosts(fused.values(), NOW);
    expect(fused.get('obs:1')!.score).toBe(before);
  });
});

describe('rankResults — filter then sort', () => {
  // Build three fused results with known scores/timestamps.
  const results = () => [
    { key: 'obs:1', kind: 'screen' as const, refId: 1, title: 'Off Grid plan', snippet: 'grid grid', surface: 'Slack', url: null, ts: NOW - 100 * DAY, imagePath: null, score: 0.1 },
    { key: 'chat:1', kind: 'chat' as const, refId: 0, title: 'A chat', snippet: 'off topic', surface: 'Chat', url: 'c1', ts: NOW - 1 * DAY, imagePath: null, score: 0.3 },
    { key: 'mem:1', kind: 'memory' as const, refId: 2, title: 'note', snippet: 'nothing', surface: 'Memory', url: null, ts: NOW - 5 * DAY, imagePath: null, score: 0.2 },
  ];

  it('relevance (default) sorts by descending score', () => {
    const out = rankResults(results(), { query: 'off grid' });
    expect(out.map((r) => r.key)).toEqual(['chat:1', 'mem:1', 'obs:1']);
  });

  it('recency sorts newest first, score breaks ties', () => {
    const out = rankResults(results(), { query: 'x', sort: 'recency' });
    expect(out.map((r) => r.key)).toEqual(['chat:1', 'mem:1', 'obs:1']);
  });

  it('match sorts by literal term overlap in title+snippet, score breaks ties', () => {
    // "grid" appears twice in obs:1 snippet + once in its title -> densest match.
    const out = rankResults(results(), { query: 'off grid', sort: 'match' });
    expect(out[0].key).toBe('obs:1');
  });

  it('match sort is NOT capped at 12 terms (uses the full query)', () => {
    // 13th term is the only one that matches -> it must still count.
    const many = ['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8', 'a9', 'a10', 'a11', 'a12', 'zebra'].join(' ');
    const rs = [
      { key: 'a', kind: 'screen' as const, refId: 1, title: 'nothing', snippet: 'here', surface: 'X', url: null, ts: 0, imagePath: null, score: 0.5 },
      { key: 'b', kind: 'screen' as const, refId: 2, title: 'zebra', snippet: 'zebra', surface: 'X', url: null, ts: 0, imagePath: null, score: 0.1 },
    ];
    const out = rankResults(rs, { query: many, sort: 'match' });
    expect(out[0].key).toBe('b'); // matched the 13th term despite lower score
  });

  it('source filter keeps only matching surfaces, case-insensitive', () => {
    const out = rankResults(results(), { query: 'x', sources: ['slack'] });
    expect(out.map((r) => r.key)).toEqual(['obs:1']);
  });

  it('excludeChatId drops that exact chat and nothing else', () => {
    const out = rankResults(results(), { query: 'x', excludeChatId: '1' });
    expect(out.map((r) => r.key)).not.toContain('chat:1');
    expect(out.map((r) => r.key)).toContain('obs:1');
  });

  it('empty input → empty output', () => {
    expect(rankResults([], { query: 'x' })).toEqual([]);
  });
});
