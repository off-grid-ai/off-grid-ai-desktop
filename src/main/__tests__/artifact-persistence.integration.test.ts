import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
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
})
