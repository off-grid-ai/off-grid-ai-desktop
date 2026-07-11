// Shared binary/file resolver for the bundled transcription runtimes. whisper-cli
// and parakeet-cli both need the same thing: "first path in a candidate list that
// exists on disk, or null" over dev vs packaged layouts. Defined once here so the
// resolver is a single source of truth rather than copy-pasted per engine.

import fs from 'fs';

/** First path in the list that exists on disk, or null. Swallows fs errors per
 *  candidate so a transient/unreadable path is treated as "not present" and skipped
 *  rather than thrown. Pure over the filesystem (no state). */
export function existing(paths: string[]): string | null {
  for (const p of paths) {
    try {
      if (fs.existsSync(p)) return p;
    } catch {
      /* ignore — treat a bad/unreadable path as absent */
    }
  }
  return null;
}
