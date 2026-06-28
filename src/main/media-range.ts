// Pure, Electron-free helpers for the loopback media server, so the range math and
// the path-allowlist guard can be unit-tested without booting Electron.

import path from 'path';

export interface ResolvedRange {
  start: number;
  end: number; // inclusive
  /** True when the request had no usable Range — caller should send a 200 full body. */
  full: boolean;
  /** True when the requested range is unsatisfiable — caller should send 416. */
  unsatisfiable: boolean;
}

/** Parse an HTTP `Range: bytes=…` header against a known file size. */
export function parseRange(rangeHeader: string | null | undefined, size: number): ResolvedRange {
  const m = rangeHeader && /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
  if (!m || (!m[1] && !m[2])) return { start: 0, end: Math.max(0, size - 1), full: true, unsatisfiable: false };
  const start = m[1] ? parseInt(m[1], 10) : Math.max(0, size - parseInt(m[2], 10));
  const end = m[1] && m[2] ? Math.min(parseInt(m[2], 10), size - 1) : size - 1;
  if (start >= size || start > end) return { start: 0, end: 0, full: false, unsatisfiable: true };
  return { start, end, full: false, unsatisfiable: false };
}

/** Is `target` inside one of `roots` (after resolving `..`)? Blocks path escapes. */
export function isPathAllowed(target: string, roots: string[]): boolean {
  if (!target) return false;
  const real = path.resolve(target);
  return roots.some((root) => {
    const r = path.resolve(root);
    return real === r || real.startsWith(r + path.sep);
  });
}
