// Relative "time ago" label for chat/project lists. Single source of truth for the
// format shared by MemoryChat and ProjectsScreen. Pure + UI-free so it's unit-testable.
//
// String inputs are DB timestamps stored as UTC WITHOUT a zone suffix, so a bare 'Z'
// is appended before parsing (matching the original per-component versions). But a
// string that ALREADY carries a zone (a trailing 'Z' or a +/-HH:MM offset, e.g. from
// toISOString()) must NOT get a second 'Z' - that yields an invalid date. Number
// (epoch ms) and Date inputs are used as-is.
const HAS_TZ = /[zZ]$|[+-]\d{2}:?\d{2}$/;

function toDate(input: string | number | Date): Date {
  if (typeof input === 'string') return new Date(HAS_TZ.test(input) ? input : input + 'Z');
  return new Date(input);
}

/** Relative label: "just now", "5m ago", "3h ago", "2d ago", else an absolute
 *  "Mon D" date once it's a week or more in the past. */
export function timeAgo(input: string | number | Date): string {
  const date = toDate(input);
  const diffMin = Math.floor((Date.now() - date.getTime()) / 60000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return `${diffDay}d ago`;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
