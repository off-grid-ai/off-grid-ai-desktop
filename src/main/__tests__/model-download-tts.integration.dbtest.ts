/**
 * Release journey #20 across real model download, activation, SQLite residency,
 * and TTS output validation. HTTP and the heavyweight ONNX worker are the only
 * controlled boundaries; every Off Grid owner between them stays production.
 */
import { afterAll, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'offgrid-model-download-tts-'))
const dataDir = path.join(root, 'data')
const resourceDir = path.join(root, 'resources')
const originalDataDir = process.env.OFFGRID_DATA_DIR
const originalResourceDir = process.env.OFFGRID_RESOURCE_DIR
process.env.OFFGRID_DATA_DIR = dataDir
process.env.OFFGRID_RESOURCE_DIR = resourceDir

vi.mock('electron', () => ({
  app: {
    getPath: () => dataDir,
    isPackaged: false,
    getAppPath: () => process.cwd(),
    getVersion: () => 'test'
  },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (value: string) => Buffer.from(value),
    decryptString: (value: Buffer) => value.toString()
  }
}))

const manager = await import('../models-manager')
const { CATALOG } = await import('@offgrid/models')
type ModelDownloadProgress = import('../models-manager').DownloadProgress
const ttsModel = CATALOG.find(
  (candidate) => candidate.kind === 'voice' && candidate.files.length === 2
)
if (!ttsModel) throw new Error('Model catalog needs a multi-file voice fixture')

interface PendingResponse {
  url: string
  resolve: (response: Response) => void
}

async function waitFor(condition: () => boolean): Promise<void> {
  const deadline = Date.now() + 2_000
  while (!condition()) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for the TTS download boundary')
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

afterAll(async () => {
  await manager.deleteModel(ttsModel.id)
  await manager.clearDownload(ttsModel.id)
  const database = await import('../database')
  database.getDB().close()
  if (originalDataDir === undefined) delete process.env.OFFGRID_DATA_DIR
  else process.env.OFFGRID_DATA_DIR = originalDataDir
  if (originalResourceDir === undefined) delete process.env.OFFGRID_RESOURCE_DIR
  else process.env.OFFGRID_RESOURCE_DIR = originalResourceDir
  fs.rmSync(root, { recursive: true, force: true })
  vi.unstubAllGlobals()
})

describe('TTS model download integration', () => {
  it('stays unavailable until every file lands, then selects and speaks a reply (#20)', async () => {
    fs.mkdirSync(resourceDir, { recursive: true })
    fs.writeFileSync(
      path.join(resourceDir, 'tts-worker.mjs'),
      [
        "import fs from 'node:fs'",
        'const [, , command, output] = process.argv',
        "if (command === 'speak' && output) {",
        '  process.stdin.resume()',
        "  process.stdin.on('end', () => {",
        "    fs.writeFileSync(output, Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(60, 1)]))",
        '  })',
        '}'
      ].join('\n'),
      { mode: 0o755 }
    )

    const pending: PendingResponse[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (input: string | URL | Request) =>
          new Promise<Response>((resolve) => pending.push({ url: String(input), resolve }))
      )
    )
    const progress: ModelDownloadProgress[] = []
    const download = manager.downloadModel(ttsModel.id, (event) => progress.push(event))

    for (const [index, file] of ttsModel.files.entries()) {
      await waitFor(() => pending.length === index + 1)
      expect(pending[index]!.url).toBe(file.url)
      expect(await manager.listInstalled()).not.toContain(ttsModel.id)

      const body = Buffer.from(`off-grid-${file.name}-${index}`)
      pending[index]!.resolve(
        new Response(new Uint8Array(body), {
          status: 200,
          headers: { 'content-length': String(body.length) }
        })
      )
      if (index < ttsModel.files.length - 1) {
        await waitFor(() => pending.length === index + 2)
        expect(await manager.listInstalled()).not.toContain(ttsModel.id)
      }
    }

    await expect(download).resolves.toEqual({ success: true })
    expect(progress.at(-1)).toMatchObject({ status: 'completed', percent: 100 })
    expect(await manager.listInstalled()).toContain(ttsModel.id)
    expect(await manager.activateModel(ttsModel.id)).toEqual({ success: true })
    expect(manager.getActiveModalities().speech).toBe(ttsModel.id)

    const { synthesize } = await import('../tts')
    const spoken = await synthesize('A local reply')

    expect(spoken.dataUrl).toMatch(/^data:audio\/wav;base64,/)
    expect(
      Buffer.from(spoken.dataUrl.split(',')[1]!, 'base64').subarray(0, 4).toString('ascii')
    ).toBe('RIFF')
  })
})
