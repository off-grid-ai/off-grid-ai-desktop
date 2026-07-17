// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync, symlinkSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { serveCaptureFile } from '../ogcapture-serve'

// Real integration over a temp file (no mocks): the ogcapture:// serving logic was inline
// in the protocol handler and untested; extracting it (so the fs reads sit behind the
// function now owns canonicalization + allowlisting beside its fs reads, so no caller can
// bypass the security boundary. These tests use real files and symlinks.

const dir = mkdtempSync(join(tmpdir(), 'ogcap-'))
const file = join(dir, 'clip.txt')
const BODY = 'off-grid-capture-bytes-0123456789'

beforeAll(() => writeFileSync(file, BODY))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

describe('serveCaptureFile', () => {
  it('serves the whole file as 200 with the right length', async () => {
    const res = await serveCaptureFile(file, [dir], null)
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Length')).toBe(String(BODY.length))
    expect(await res.text()).toBe(BODY)
  })

  it('honours a byte Range with a 206 partial body', async () => {
    const res = await serveCaptureFile(file, [dir], 'bytes=0-8')
    expect(res.status).toBe(206)
    expect(res.headers.get('Content-Range')).toBe(`bytes 0-8/${BODY.length}`)
    expect(await res.text()).toBe(BODY.slice(0, 9)) // inclusive end
  })

  it('serves a suffix range (bytes=-N -> last N bytes)', async () => {
    const res = await serveCaptureFile(file, [dir], 'bytes=-5')
    expect(res.status).toBe(206)
    expect(await res.text()).toBe(BODY.slice(-5))
  })

  it('returns 416 for an unsatisfiable range past EOF', async () => {
    const res = await serveCaptureFile(file, [dir], 'bytes=99999-')
    expect(res.status).toBe(416)
    expect(res.headers.get('Content-Range')).toBe(`bytes */${BODY.length}`)
  })

  it('returns 404 when the file does not exist (fs error is contained)', async () => {
    const res = await serveCaptureFile(join(dir, 'missing.bin'), [dir], null)
    expect(res.status).toBe(404)
  })

  it('returns 403 for traversal and sibling-prefix paths outside the allowed root', async () => {
    const sibling = `${dir}-evil`
    mkdirSync(sibling)
    const secret = join(sibling, 'secret.txt')
    writeFileSync(secret, 'private')
    try {
      expect(
        (
          await serveCaptureFile(
            join(dir, '..', `${dir.split('/').pop()}-evil`, 'secret.txt'),
            [dir],
            null
          )
        ).status
      ).toBe(403)
      expect((await serveCaptureFile(secret, [dir], null)).status).toBe(403)
    } finally {
      rmSync(sibling, { recursive: true, force: true })
    }
  })

  it('returns 403 when a symlink inside the root points to a file outside it', async () => {
    const outside = mkdtempSync(join(tmpdir(), 'ogcap-outside-'))
    const secret = join(outside, 'secret.txt')
    const link = join(dir, 'escaped.txt')
    writeFileSync(secret, 'private')
    symlinkSync(secret, link)
    try {
      const res = await serveCaptureFile(link, [dir], null)
      expect(res.status).toBe(403)
    } finally {
      rmSync(link, { force: true })
      rmSync(outside, { recursive: true, force: true })
    }
  })
})
