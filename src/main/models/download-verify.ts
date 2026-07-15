// Integrity gate run before a finished download is promoted from `<file>.part` to
// its final name (and recorded as installed). Isolated + testable so the check that
// keeps a broken model off disk isn't buried in the download I/O.
//
// D2: the download loop renamed .part -> final with NO verification. A server that
// closed the connection early (flaky CDN / HF mirror), or any short read, left a
// TRUNCATED file that was marked installed + activatable — then llama-server died
// on load with a blank "Chat model Down" (the exact class CLAUDE.md warns about).
import fs from 'fs';
import { isValidGgufFile } from './gguf';

/** Reason a just-downloaded file must NOT be promoted to installed, or null if it
 *  passes. Checks the byte count (when the server reported a length) and, for a
 *  GGUF, the magic header + minimum size. */
export function downloadIntegrityError(name: string, written: number, total: number, partPath: string): string | null {
  if (total > 0 && written < total) {
    return `${name}: incomplete download (${written}/${total} bytes) — the connection closed early`;
  }
  if (/\.gguf$/i.test(name) && !isValidGgufFile(partPath, fs)) {
    return `${name}: downloaded file is not a valid GGUF (corrupt or truncated)`;
  }
  return null;
}
