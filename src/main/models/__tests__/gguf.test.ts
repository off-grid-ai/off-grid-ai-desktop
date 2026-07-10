/**
 * Tests for the shared GGUF integrity check. isValidGgufHeader is pure (size +
 * magic bytes); isValidGgufFile is exercised against REAL files in a temp dir
 * (no fs mock) so the read path is proven, not simulated.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { isValidGgufHeader, isValidGgufFile, GGUF_MIN_BYTES } from '../gguf';

describe('isValidGgufHeader — pure size + magic judgement', () => {
  it('accepts a big-enough file whose first four bytes are the GGUF magic', () => {
    expect(isValidGgufHeader(GGUF_MIN_BYTES, Buffer.from('GGUF', 'ascii'))).toBe(true);
    expect(isValidGgufHeader(10_000_000, Buffer.from('GGUF', 'ascii'))).toBe(true);
  });

  it('rejects a file under the minimum size even with the right magic', () => {
    expect(isValidGgufHeader(GGUF_MIN_BYTES - 1, Buffer.from('GGUF', 'ascii'))).toBe(false);
    expect(isValidGgufHeader(0, Buffer.from('GGUF', 'ascii'))).toBe(false);
  });

  it('rejects a big-enough file with the wrong magic', () => {
    expect(isValidGgufHeader(10_000_000, Buffer.from('ELF\0', 'ascii'))).toBe(false);
    expect(isValidGgufHeader(10_000_000, Buffer.from('\0\0\0\0', 'binary'))).toBe(false);
  });
});

describe('isValidGgufFile — real files in a temp dir', () => {
  let dir: string;
  const write = (name: string, contents: Buffer): string => {
    const p = path.join(dir, name);
    fs.writeFileSync(p, contents);
    return p;
  };

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gguf-test-'));
  });
  afterAll(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('accepts a real file with the GGUF magic and enough padding', () => {
    const buf = Buffer.concat([Buffer.from('GGUF', 'ascii'), Buffer.alloc(GGUF_MIN_BYTES)]);
    expect(isValidGgufFile(write('good.gguf', buf), fs)).toBe(true);
  });

  it('rejects a truncated file (right magic but under the size floor)', () => {
    expect(isValidGgufFile(write('tiny.gguf', Buffer.from('GGUF', 'ascii')), fs)).toBe(false);
  });

  it('rejects a big file with the wrong magic (corrupt/other format)', () => {
    const buf = Buffer.concat([Buffer.from('%PDF', 'ascii'), Buffer.alloc(GGUF_MIN_BYTES)]);
    expect(isValidGgufFile(write('wrong.gguf', buf), fs)).toBe(false);
  });

  it('returns false (never throws) for a nonexistent file', () => {
    expect(isValidGgufFile(path.join(dir, 'nope.gguf'), fs)).toBe(false);
  });
});
