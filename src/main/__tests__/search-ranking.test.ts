/**
 * Regression tests for unified-search RANKING behaviour added this session:
 *   - recency bias (this week > last month > last quarter > older)
 *   - own-content nudge so chats / KB docs aren't buried under ambient captures
 *   - "Match" sort = literal term overlap
 * Pure math (no DB/Electron), mirroring model-sizing.test.ts.
 */
import { describe, it, expect } from 'vitest';
import { recencyBoost, kindBoost, matchScore } from '../search-ranking';

const DAY = 86_400_000;
const NOW = 1_800_000_000_000; // fixed "now" so tests are deterministic

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
