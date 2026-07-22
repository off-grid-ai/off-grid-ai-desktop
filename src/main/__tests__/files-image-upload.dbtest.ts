// Image attachment integration at the real file-processing seam. Electron's
// userData location is the only fake; sharp decoding and filesystem persistence are
// real, so extension-only acceptance cannot keep this test green.

import { afterAll, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import sharp from 'sharp'

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'offgrid-image-upload-'))

vi.mock('electron', () => ({
  app: { getPath: () => userData }
}))

import { processUpload } from '../files'

afterAll(() => {
  fs.rmSync(userData, { recursive: true, force: true })
})

describe('processUpload image validation', () => {
  it('persists a decodable image and returns its vision-model path', async () => {
    const bytes = await sharp({
      create: { width: 2, height: 2, channels: 3, background: '#34D399' }
    })
      .png()
      .toBuffer()

    const result = await processUpload('fixture.png', bytes)

    expect(result).toMatchObject({ name: 'fixture.png', kind: 'image', text: '' })
    expect(result.path).toBeTruthy()
    expect(fs.readFileSync(result.path!)).toEqual(bytes)
  })

  it('rejects damaged image bytes without leaving an uploaded file behind', async () => {
    const uploads = path.join(userData, 'uploads')
    const before = fs.existsSync(uploads) ? fs.readdirSync(uploads) : []

    await expect(processUpload('damaged.png', Buffer.from('not a png'))).rejects.toThrow(
      'Unsupported or damaged image data.'
    )

    expect(fs.existsSync(uploads) ? fs.readdirSync(uploads) : []).toEqual(before)
  })
})
