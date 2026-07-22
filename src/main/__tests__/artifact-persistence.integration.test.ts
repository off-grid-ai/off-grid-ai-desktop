import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'offgrid-artifact-persistence-'))

vi.mock('electron', () => ({
  app: { getPath: () => TMP_DIR, isPackaged: false, getAppPath: () => process.cwd() }
}))

beforeEach(() => {
  fs.rmSync(path.join(TMP_DIR, 'artifacts-library'), { recursive: true, force: true })
})

afterEach(() => {
  vi.restoreAllMocks()
})

afterAll(() => {
  fs.rmSync(TMP_DIR, { recursive: true, force: true })
})

describe('artifact persistence across an app module reload', () => {
  it('saves and reopens the exact text artifact body and scope', async () => {
    const { saveArtifact } = await import('../artifacts')
    const text = 'Launch checklist\n\n- Sign build\n- Verify offline startup'

    const saved = saveArtifact({
      kind: 'text',
      code: text,
      title: 'Launch checklist',
      conversationId: 'conversation-text',
      projectId: 'project-release'
    })

    vi.resetModules()
    const { listArtifacts } = await import('../artifacts')
    const reopened = listArtifacts({ conversationId: 'conversation-text' })

    expect(reopened).toEqual([
      expect.objectContaining({
        id: saved.id,
        kind: 'text',
        code: text,
        title: 'Launch checklist',
        conversationId: 'conversation-text',
        projectId: 'project-release'
      })
    ])
  })

  it('saves and reopens an image artifact whose on-disk bytes remain available', async () => {
    const uploadsDir = path.join(TMP_DIR, 'uploads')
    const imagePath = path.join(uploadsDir, 'architecture.png')
    const imageBytes = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      'base64'
    )
    fs.mkdirSync(uploadsDir, { recursive: true })
    fs.writeFileSync(imagePath, imageBytes)

    const { saveArtifact } = await import('../artifacts')
    const saved = saveArtifact({
      kind: 'image',
      code: imagePath,
      title: 'Architecture sketch',
      conversationId: 'conversation-image',
      projectId: 'project-release'
    })

    vi.resetModules()
    const { listArtifacts } = await import('../artifacts')
    const [reopened] = listArtifacts({ projectId: 'project-release' }).filter(
      (artifact) => artifact.id === saved.id
    )

    expect(reopened).toMatchObject({
      kind: 'image',
      code: imagePath,
      title: 'Architecture sketch',
      conversationId: 'conversation-image',
      projectId: 'project-release'
    })
    expect(fs.readFileSync(reopened!.code)).toEqual(imageBytes)
  })

  it('contains an exhausted-filesystem write and keeps existing artifacts readable', async () => {
    const { saveArtifact } = await import('../artifacts')
    const existing = saveArtifact({
      kind: 'text',
      code: 'Existing release notes',
      title: 'Existing release notes',
      conversationId: 'conversation-existing'
    })
    const writeFileSync = fs.writeFileSync.bind(fs)
    const existingFile = path.join(TMP_DIR, 'artifacts-library', `${existing.id}.json`)
    let acceptedBytes = 0
    let partialExistedAtFailure = false

    vi.spyOn(fs, 'writeFileSync').mockImplementation((target, data, options) => {
      if (String(target) !== existingFile) {
        const serialized = Buffer.isBuffer(data) ? data : Buffer.from(data.toString())
        const accepted = serialized.subarray(0, 24)
        writeFileSync(String(target), accepted)
        acceptedBytes = accepted.length
        partialExistedAtFailure = fs.statSync(String(target)).size === acceptedBytes
        throw Object.assign(new Error('ENOSPC: no space left on device, write'), {
          code: 'ENOSPC'
        })
      }
      return writeFileSync(String(target), data, options)
    })

    expect(() =>
      saveArtifact({
        kind: 'html',
        code: '<h1>New artifact</h1>',
        conversationId: 'conversation-new'
      })
    ).toThrow('ENOSPC: no space left on device, write')

    vi.restoreAllMocks()
    vi.resetModules()
    const { listArtifacts } = await import('../artifacts')

    expect({ acceptedBytes, partialExistedAtFailure }).toEqual({
      acceptedBytes: 24,
      partialExistedAtFailure: true
    })
    expect(fs.readdirSync(path.join(TMP_DIR, 'artifacts-library'))).toEqual([`${existing.id}.json`])
    expect(listArtifacts()).toEqual([
      expect.objectContaining({
        id: existing.id,
        code: 'Existing release notes',
        conversationId: 'conversation-existing'
      })
    ])
  })
})
