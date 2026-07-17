// Exercises the real model-manager ingress paths against a temporary models
// directory. Network delivery is the only boundary fake; validation, streaming,
// filesystem promotion, registry state, and installed-model discovery stay real.
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { Writable } from 'stream'

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

const secondModel = CATALOG.find(
  (entry) =>
    entry.id !== model.id &&
    entry.kind === 'text' &&
    entry.files.length === 1 &&
    entry.files.some((file) => file.name.endsWith('.gguf'))
)

if (!secondModel) throw new Error('Model catalog has no second single-file text GGUF fixture')

const secondModelFile = secondModel.files.at(0)?.name
if (!secondModelFile) throw new Error(`${secondModel.id} has no downloadable file`)
const secondModelPath = path.join(dataDir, 'models', secondModelFile)

beforeAll(() => {
  fs.mkdirSync(path.dirname(modelPath), { recursive: true })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  fs.rmSync(modelPath, { force: true })
  fs.rmSync(`${modelPath}.part`, { force: true })
  fs.rmSync(secondModelPath, { force: true })
  fs.rmSync(`${secondModelPath}.part`, { force: true })
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

  it('contains and reports a disk-full write failure without disturbing installed state', async () => {
    fs.writeFileSync(modelPath, Buffer.concat([Buffer.from('GGUF', 'ascii'), Buffer.alloc(2_000)]))
    expect(await manager.listInstalled()).toContain(model.id)

    const body = Buffer.concat([Buffer.from('GGUF', 'ascii'), Buffer.alloc(2_000)])
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Promise.resolve(
          new Response(body, {
            status: 200,
            headers: { 'content-length': String(body.length) }
          })
        )
      )
    )

    const createWriteStream = fs.createWriteStream.bind(fs)
    vi.spyOn(fs, 'createWriteStream').mockImplementation((target, options) => {
      if (target === `${secondModelPath}.part`) {
        return new Writable({
          write(_chunk, _encoding, callback) {
            const error = Object.assign(new Error('ENOSPC: no space left on device, write'), {
              code: 'ENOSPC'
            })
            callback(error)
          }
        }) as unknown as fs.WriteStream
      }
      return createWriteStream(target, options)
    })

    const result = await manager.downloadModel(secondModel.id)

    expect(result).toEqual({
      success: false,
      error: 'ENOSPC: no space left on device, write'
    })
    expect(fs.existsSync(secondModelPath)).toBe(false)
    expect(fs.existsSync(`${secondModelPath}.part`)).toBe(false)
    expect(await manager.listInstalled()).toContain(model.id)
    expect(await manager.listInstalled()).not.toContain(secondModel.id)
    expect(manager.downloadStatus(secondModel.id)).toMatchObject({
      modelId: secondModel.id,
      status: 'failed',
      error: result.error
    })
  })
})
