/**
 * Low-space capture containment at the real vision-service seam. Electron's
 * desktopCapturer is the OS boundary; the production VisionService owns the
 * thumbnail-to-file path. ENOSPC is injected only where Node writes the PNG.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const fixture = vi.hoisted(() => ({
  tmpDir: `/tmp/offgrid-vision-low-disk-${process.pid}-${Date.now()}`
}))
const TMP_DIR = fixture.tmpDir
const CAPTURES_DIR = path.join(TMP_DIR, 'captures')

vi.mock('electron', () => ({
  app: { getPath: () => fixture.tmpDir },
  desktopCapturer: {
    getSources: async () => [
      {
        name: 'Release notes',
        display_id: '1',
        thumbnail: {
          isEmpty: () => false,
          toPNG: () => Buffer.from('synthetic screenshot bytes')
        }
      }
    ]
  },
  screen: {
    getCursorScreenPoint: () => ({ x: 0, y: 0 }),
    getDisplayNearestPoint: () => ({ id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 } })
  }
}))

import { vision } from '../vision'

beforeEach(() => {
  fs.mkdirSync(CAPTURES_DIR, { recursive: true })
  for (const name of fs.readdirSync(CAPTURES_DIR)) {
    fs.rmSync(path.join(CAPTURES_DIR, name), { force: true })
  }
})

afterEach(() => {
  vi.restoreAllMocks()
})

afterAll(() => {
  fs.rmSync(TMP_DIR, { recursive: true, force: true })
})

describe('vision capture on an exhausted filesystem', () => {
  it('stops safely without creating a corrupt capture or disturbing existing bytes', async () => {
    const existing = path.join(CAPTURES_DIR, 'existing.png')
    const existingBytes = Buffer.from('existing readable capture')
    fs.writeFileSync(existing, existingBytes)
    const diskFull = Object.assign(new Error('ENOSPC: no space left on device, write'), {
      code: 'ENOSPC'
    })
    vi.spyOn(fs.promises, 'writeFile').mockRejectedValueOnce(diskFull)
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const result = await vision.captureAppWindow('Notes', 'Release notes')

    expect(result).toBeNull()
    expect(fs.readdirSync(CAPTURES_DIR)).toEqual(['existing.png'])
    expect(fs.readFileSync(existing)).toEqual(existingBytes)
    expect(console.error).toHaveBeenCalledWith('Vision Capture Failed:', diskFull)
  })
})
