import { describe, it, expect, vi, afterEach } from 'vitest';
import { timeAgo } from '../time';

// A fixed "now" so every bucket is deterministic. Chosen mid-month so the
// week-plus absolute date can't underflow into the previous month.
const NOW = new Date('2026-06-15T12:00:00Z').getTime();

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** Build a Date `ms` in the PAST relative to the frozen NOW. */
function ago(ms: number): Date {
  return new Date(NOW - ms);
}

afterEach(() => {
  vi.useRealTimers();
});

describe('timeAgo — relative label buckets', () => {
  function freeze() {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  }

  it('under a minute reads "just now"', () => {
    freeze();
    expect(timeAgo(ago(0))).toBe('just now');
    expect(timeAgo(ago(30 * 1000))).toBe('just now');
    expect(timeAgo(ago(59 * 1000))).toBe('just now');
  });

  it('minutes bucket: "Nm ago" from 1 to 59', () => {
    freeze();
    expect(timeAgo(ago(1 * MIN))).toBe('1m ago');
    expect(timeAgo(ago(5 * MIN))).toBe('5m ago');
    expect(timeAgo(ago(59 * MIN))).toBe('59m ago');
  });

  it('hours bucket: "Nh ago" from 1 to 23', () => {
    freeze();
    expect(timeAgo(ago(1 * HOUR))).toBe('1h ago');
    expect(timeAgo(ago(3 * HOUR))).toBe('3h ago');
    expect(timeAgo(ago(23 * HOUR))).toBe('23h ago');
  });

  it('days bucket: "Nd ago" from 1 to 6', () => {
    freeze();
    expect(timeAgo(ago(1 * DAY))).toBe('1d ago');
    expect(timeAgo(ago(6 * DAY))).toBe('6d ago');
  });

  it('a week or more falls back to an absolute "Mon D" date', () => {
    freeze();
    // 8 days before 2026-06-15 is 2026-06-07.
    const label = timeAgo(ago(8 * DAY));
    expect(label).not.toMatch(/ago|just now/);
    // toLocaleDateString with month:'short', day:'numeric' — assert against the
    // same formatter so the test isn't locale-brittle.
    const expected = ago(8 * DAY).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    expect(label).toBe(expected);
  });

  it('exactly 7 days is already the absolute-date boundary (not "7d ago")', () => {
    freeze();
    expect(timeAgo(ago(7 * DAY))).not.toMatch(/ago/);
  });

  it('a future timestamp clamps to "just now" (negative diff floors below 1)', () => {
    freeze();
    expect(timeAgo(new Date(NOW + 5 * MIN))).toBe('just now');
    expect(timeAgo(new Date(NOW + 10 * DAY))).toBe('just now');
  });
});

describe('timeAgo — input types', () => {
  function freeze() {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  }

  it('accepts a Date', () => {
    freeze();
    expect(timeAgo(ago(2 * MIN))).toBe('2m ago');
  });

  it('accepts epoch millis (number), used as-is', () => {
    freeze();
    expect(timeAgo(NOW - 2 * HOUR)).toBe('2h ago');
  });

  it('string inputs are treated as UTC — a bare "Z" is appended before parsing', () => {
    freeze();
    // The DB stores UTC without a zone suffix. Two hours before NOW, no suffix.
    const twoHoursAgoUtc = new Date(NOW - 2 * HOUR).toISOString().replace('Z', '');
    expect(timeAgo(twoHoursAgoUtc)).toBe('2h ago');
  });

  it('a string WITH its own "Z" would be mis-parsed — the raw contract expects no suffix', () => {
    freeze();
    // Appending a second 'Z' produces an invalid date; guard documents the contract
    // so a caller can't silently start passing already-zoned strings.
    const doubled = new Date(NOW - 2 * HOUR).toISOString(); // ends in 'Z'
    expect(Number.isNaN(new Date(doubled + 'Z').getTime())).toBe(true);
  });
});
