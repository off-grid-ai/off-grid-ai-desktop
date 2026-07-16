// D2 — a finished download must be verified before it's promoted to installed.
// A truncated file (server closed early) or a corrupt GGUF used to be renamed to
// its final name and marked installed, then llama-server died on load with a blank
// "Chat model Down". downloadIntegrityError is the gate; the loop throws on it
// instead of renaming.

import { describe, it, expect, afterAll } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { downloadIntegrityError } from '../download-verify'

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'offgrid-dlverify-'))
const write = (name: string, buf: Buffer): string => {
  const p = path.join(TMP, name)
  fs.writeFileSync(p, buf)
  return p
}
const validGguf = Buffer.concat([Buffer.from('GGUF', 'ascii'), Buffer.alloc(2000)]) // magic + >1024 bytes
afterAll(() => {
  try {
    fs.rmSync(TMP, { recursive: true, force: true })
  } catch {
    /* best effort */
  }
})

describe('downloadIntegrityError (D2)', () => {
  it('rejects a truncated download (written < the server-reported total)', () => {
    const p = write('model.gguf', validGguf)
    expect(downloadIntegrityError('model.gguf', 1500, 3000, p)).toMatch(/incomplete/)
  })

  it('rejects a corrupt GGUF (wrong magic) even when the byte count matches', () => {
    const bad = write('bad.gguf', Buffer.concat([Buffer.from('XXXX'), Buffer.alloc(2000)]))
    expect(downloadIntegrityError('bad.gguf', 2004, 2004, bad)).toMatch(/not a valid GGUF/)
  })

  it('rejects a GGUF that is under the minimum size', () => {
    const tiny = write('tiny.gguf', Buffer.from('GGUF'))
    expect(downloadIntegrityError('tiny.gguf', 4, 4, tiny)).toMatch(/not a valid GGUF/)
  })

  it('passes a complete, valid GGUF', () => {
    const p = write('good.gguf', validGguf)
    expect(downloadIntegrityError('good.gguf', validGguf.length, validGguf.length, p)).toBeNull()
  })

  it('passes a complete non-GGUF file (no magic check applies)', () => {
    const p = write('tokenizer.json', Buffer.alloc(50))
    expect(downloadIntegrityError('tokenizer.json', 50, 50, p)).toBeNull()
  })

  it('passes when the server gave no length (total = 0) and the file is fine', () => {
    const p = write('nolen.bin', Buffer.alloc(10))
    expect(downloadIntegrityError('nolen.bin', 10, 0, p)).toBeNull()
  })
})
