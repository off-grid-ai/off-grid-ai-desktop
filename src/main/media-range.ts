// Pure, Electron-free helpers for the loopback media server, so the range math and
// the path-allowlist guard can be unit-tested without booting Electron.

import path from 'path';
import fs from 'fs';

/** Canonicalize a path: resolve symlinks + `..` to the real on-disk path. Falls
 *  back to a plain `path.resolve` when the path doesn't exist yet (realpath throws). */
function canonical(p: string): string {
  try {
    return fs.realpathSync.native(p);
  } catch {
    return path.resolve(p);
  }
}

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

/** Is `target` inside one of `roots`? Symlink-safe: both sides are canonicalized
 *  (realpath) so a symlink inside a root can't smuggle a path outside it, and `..`
 *  escapes are normalized away. */
export function isPathAllowed(target: string, roots: string[]): boolean {
  if (!target) return false;
  const real = canonical(target);
  return roots.some((root) => {
    const r = canonical(root);
    return real === r || real.startsWith(r + path.sep);
  });
}
