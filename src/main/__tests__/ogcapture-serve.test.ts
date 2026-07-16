// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { serveCaptureFile } from '../ogcapture-serve'

// Real integration over a temp file (no mocks): the ogcapture:// serving logic was inline
// in the protocol handler and untested; extracting it (so the fs reads sit behind the
// handler's canonicalize+allowlist guard, satisfying Sonar S2083) also makes it testable.
// The caller is responsible for passing an ALREADY-validated path — these tests give it a
// real file and assert the HTTP-shaped Response.

const dir = mkdtempSync(join(tmpdir(), 'ogcap-'))
const file = join(dir, 'clip.txt')
const BODY = 'off-grid-capture-bytes-0123456789'

beforeAll(() => writeFileSync(file, BODY))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

describe('serveCaptureFile', () => {
  it('serves the whole file as 200 with the right length', async () => {
    const res = await serveCaptureFile(file, null)
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Length')).toBe(String(BODY.length))
    expect(await res.text()).toBe(BODY)
  })

  it('honours a byte Range with a 206 partial body', async () => {
    const res = await serveCaptureFile(file, 'bytes=0-8')
    expect(res.status).toBe(206)
    expect(res.headers.get('Content-Range')).toBe(`bytes 0-8/${BODY.length}`)
    expect(await res.text()).toBe(BODY.slice(0, 9)) // inclusive end
  })

  it('serves a suffix range (bytes=-N -> last N bytes)', async () => {
    const res = await serveCaptureFile(file, 'bytes=-5')
    expect(res.status).toBe(206)
    expect(await res.text()).toBe(BODY.slice(-5))
  })

  it('returns 416 for an unsatisfiable range past EOF', async () => {
    const res = await serveCaptureFile(file, 'bytes=99999-')
    expect(res.status).toBe(416)
    expect(res.headers.get('Content-Range')).toBe(`bytes */${BODY.length}`)
  })

  it('returns 404 when the file does not exist (fs error is contained)', async () => {
    const res = await serveCaptureFile(join(dir, 'missing.bin'), null)
    expect(res.status).toBe(404)
  })
})
