// Exercises the real model-manager ingress paths against a temporary models
// directory. Network delivery is the only boundary fake; validation, streaming,
// filesystem promotion, registry state, and installed-model discovery stay real.
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'

const originalDataDir = process.env.OFFGRID_DATA_DIR
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'offgrid-model-integrity-'))
process.env.OFFGRID_DATA_DIR = dataDir

const manager = await import('../../models-manager')
const { CATALOG } = await import('@offgrid/models')

const model = CATALOG.find(
  (entry) =>
    entry.kind === 'text' &&
    entry.files.length === 1 &&
    entry.files.some((file) => file.name.endsWith('.gguf'))
)

if (!model) throw new Error('Model catalog has no single-file text GGUF fixture')

const modelFile = model.files.at(0)?.name
if (!modelFile) throw new Error(`${model.id} has no downloadable file`)
const modelPath = path.join(dataDir, 'models', modelFile)

beforeAll(() => {
  fs.mkdirSync(path.dirname(modelPath), { recursive: true })
})

afterEach(() => {
  vi.unstubAllGlobals()
  fs.rmSync(modelPath, { force: true })
  fs.rmSync(`${modelPath}.part`, { force: true })
})

afterAll(() => {
  if (originalDataDir === undefined) delete process.env.OFFGRID_DATA_DIR
  else process.env.OFFGRID_DATA_DIR = originalDataDir
  fs.rmSync(dataDir, { recursive: true, force: true })
})

describe('model-manager GGUF integrity', () => {
  it('rejects a truncated GGUF download before promotion or installation', async () => {
    const truncated = Buffer.from('GGUF', 'ascii')
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Promise.resolve(
          new Response(truncated, {
            status: 200,
            headers: { 'content-length': String(truncated.length) }
          })
        )
      )
    )

    const result = await manager.downloadModel(model.id)

    expect(result).toEqual({
      success: false,
      error: `${modelFile}: downloaded file is not a valid GGUF (corrupt or truncated)`
    })
    expect(fs.existsSync(modelPath)).toBe(false)
    expect(await manager.listInstalled()).not.toContain(model.id)
    expect(manager.downloadStatus(model.id)).toMatchObject({
      modelId: model.id,
      status: 'failed',
      error: result.error
    })
  })

  it('rejects a truncated local GGUF before copying or registration', async () => {
    const source = path.join(dataDir, 'truncated.gguf')
    fs.writeFileSync(source, Buffer.from('GGUF', 'ascii'))

    const result = await manager.importLocalModel(source)

    expect(result).toEqual({
      success: false,
      error: 'File is not a valid GGUF model (corrupt or wrong format)'
    })
    expect(fs.existsSync(path.join(dataDir, 'models', 'truncated.gguf'))).toBe(false)
    expect(manager.getLocalModels()).toEqual([])
  })
})
