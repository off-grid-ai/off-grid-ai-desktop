// Single source of truth for the cheap GGUF integrity check. A real GGUF file
// starts with the ASCII magic "GGUF" and is more than a few bytes; this catches
// truncated/corrupt downloads before the file is handed to llama-server (which
// would otherwise crash on load). The byte-inspection is split from the fs read
// so the decision is pure + unit-testable, while both call sites (models-manager
// import + LLMService.validateGguf) share one implementation instead of two
// hand-kept copies that could drift.

/** The GGUF file-format magic number, as the first four bytes. */
const GGUF_MAGIC = 'GGUF';

/** Minimum plausible size for a real model file; anything smaller is a stub or a
 *  truncated download. */
export const GGUF_MIN_BYTES = 1024;

/**
 * Decide whether a file's size + first four bytes identify a valid GGUF model.
 * Pure: the caller reads the size and the leading bytes; this judges them.
 */
export function isValidGgufHeader(sizeBytes: number, firstFourBytes: Buffer): boolean {
  if (sizeBytes < GGUF_MIN_BYTES) return false;
  return firstFourBytes.toString('ascii') === GGUF_MAGIC;
}

/** The subset of `fs` this check needs — injected so the read path is testable
 *  against a real temp file (or a fake) without importing node fs into callers'
 *  test setups. */
export interface GgufFs {
  statSync(p: string): { size: number };
  openSync(p: string, flags: string): number;
  readSync(fd: number, buffer: Buffer, offset: number, length: number, position: number): number;
  closeSync(fd: number): void;
}

/**
 * Read a file's size + leading magic and judge whether it is a valid GGUF model.
 * Returns false on any fs error (missing/unreadable file). This is the single
 * implementation both call sites (models-manager import + LLMService) share.
 */
export function isValidGgufFile(p: string, fs: GgufFs): boolean {
  try {
    const size = fs.statSync(p).size;
    if (size < GGUF_MIN_BYTES) return false;
    const fd = fs.openSync(p, 'r');
    const buf = Buffer.alloc(4);
    // try/finally so a readSync throw can't leak the descriptor (the outer catch
    // swallows the error, so without this the fd would never be closed).
    try {
      fs.readSync(fd, buf, 0, 4, 0);
    } finally {
      fs.closeSync(fd);
    }
    return isValidGgufHeader(size, buf);
  } catch {
    return false;
  }
}
