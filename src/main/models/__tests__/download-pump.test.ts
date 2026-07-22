// D1 — a model download must NOT crash the app when the write fails (disk full /
// EIO). The naive inline loop attached no 'error' listener to the write stream, so
// such an error became an unhandled 'error' event → the whole main process crashed
// (and 'finish' never fires after an error, so awaiting it would hang forever).
//
// pumpToFile is the extracted write half. We test it over a REAL Node write stream
// (the filesystem is the true boundary — no fakes of our own code) with a fake
// byte reader standing in for the network body:
//  - happy path: bytes land on disk (the terminal artifact).
//  - error path: a stream pointed at a non-existent directory emits a real ENOENT
//    'error'; pumpToFile must REJECT gracefully — the test REACHING its assertion
//    (instead of the worker crashing / timing out) is the proof it no longer takes
//    the process down.

import { describe, it, expect, afterAll } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { pumpToFile } from '../download-pump'

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'offgrid-pump-'))
afterAll(() => {
  try {
    fs.rmSync(TMP, { recursive: true, force: true })
  } catch {
    /* best effort */
  }
})

interface ByteReader {
  read(): Promise<{ done: boolean; value?: Uint8Array }>
}
function readerOf(chunks: Uint8Array[]): ByteReader {
  let i = 0
  return {
    read: () =>
      Promise.resolve(i < chunks.length ? { done: false, value: chunks[i++] } : { done: true })
  }
}

describe('pumpToFile (D1 — download write path)', () => {
  it('writes the body to disk and reports each chunk length', async () => {
    const file = path.join(TMP, 'ok.part')
    const out = fs.createWriteStream(file)
    const seen: number[] = []

    await pumpToFile(readerOf([Buffer.from('hello '), Buffer.from('world')]), out, (n) =>
      seen.push(n)
    )

    // Terminal artifact: the file on disk holds the full body.
    expect(fs.readFileSync(file, 'utf8')).toBe('hello world')
    expect(seen).toEqual([6, 5])
  })

  it('rejects (does NOT crash the process) when the write stream errors', async () => {
    // Parent dir does not exist → the stream emits a real ENOENT 'error'.
    const out = fs.createWriteStream(path.join(TMP, 'missing-dir', 'sub', 'bad.part'))

    await expect(pumpToFile(readerOf([Buffer.from('data')]), out, () => {})).rejects.toThrow()
    // Reaching here at all means the unhandled 'error' did not take the process down.
  })
})
