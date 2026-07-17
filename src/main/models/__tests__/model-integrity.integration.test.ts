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

const fixtures = CATALOG.flatMap((entry) => {
  const file = entry.files.at(0)
  if (entry.kind !== 'text' || entry.files.length !== 1 || !file?.name.endsWith('.gguf')) return []
  return [{ entry, fileName: file.name, filePath: path.join(dataDir, 'models', file.name) }]
})

const [primary, diskFailure, interrupted] = fixtures
if (!primary || !diskFailure || !interrupted) {
  throw new Error('Model catalog needs three single-file text GGUF fixtures')
}

beforeAll(() => {
  fs.mkdirSync(path.dirname(primary.filePath), { recursive: true })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  for (const fixture of fixtures) {
    fs.rmSync(fixture.filePath, { force: true })
    fs.rmSync(`${fixture.filePath}.part`, { force: true })
  }
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

    const result = await manager.downloadModel(primary.entry.id)

    expect(result).toEqual({
      success: false,
      error: `${primary.fileName}: downloaded file is not a valid GGUF (corrupt or truncated)`
    })
    expect(fs.existsSync(primary.filePath)).toBe(false)
    expect(await manager.listInstalled()).not.toContain(primary.entry.id)
    expect(manager.downloadStatus(primary.entry.id)).toMatchObject({
      modelId: primary.entry.id,
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
    fs.writeFileSync(
      primary.filePath,
      Buffer.concat([Buffer.from('GGUF', 'ascii'), Buffer.alloc(2_000)])
    )
    expect(await manager.listInstalled()).toContain(primary.entry.id)

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
      if (target === `${diskFailure.filePath}.part`) {
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

    const result = await manager.downloadModel(diskFailure.entry.id)

    expect(result).toEqual({
      success: false,
      error: 'ENOSPC: no space left on device, write'
    })
    expect(fs.existsSync(diskFailure.filePath)).toBe(false)
    expect(fs.existsSync(`${diskFailure.filePath}.part`)).toBe(false)
    expect(await manager.listInstalled()).toContain(primary.entry.id)
    expect(await manager.listInstalled()).not.toContain(diskFailure.entry.id)
    expect(manager.downloadStatus(diskFailure.entry.id)).toMatchObject({
      modelId: diskFailure.entry.id,
      status: 'failed',
      error: result.error
    })
  })

  it('restores an interrupted download after restart and resumes it without corruption', async () => {
    const complete = Buffer.concat([Buffer.from('GGUF', 'ascii'), Buffer.alloc(2_000, 7)])
    const splitAt = 700
    const prefix = complete.subarray(0, splitAt)
    const suffix = complete.subarray(splitAt)
    let delivery = 0
    let retryRange: string | undefined

    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input, init?: RequestInit) => {
        delivery++
        if (delivery === 1) {
          let pull = 0
          const interruptedBody = new ReadableStream<Uint8Array>({
            pull(controller) {
              if (pull++ === 0) {
                controller.enqueue(prefix)
                return
              }
              controller.error(new Error('network connection interrupted'))
            }
          })
          return new Response(interruptedBody, {
            status: 200,
            headers: { 'content-length': String(complete.length) }
          })
        }

        retryRange = new Headers(init?.headers).get('range') ?? undefined
        return new Response(suffix, {
          status: 206,
          headers: { 'content-length': String(suffix.length) }
        })
      })
    )

    const firstAttempt = await manager.downloadModel(interrupted.entry.id)

    expect(firstAttempt).toEqual({ success: false, error: 'network connection interrupted' })
    expect(fs.readFileSync(`${interrupted.filePath}.part`)).toEqual(prefix)
    expect(fs.existsSync(interrupted.filePath)).toBe(false)

    vi.resetModules()
    const restartedManager = await import('../../models-manager')
    expect(restartedManager.listDownloads()).toContainEqual(
      expect.objectContaining({
        modelId: interrupted.entry.id,
        status: 'failed',
        error: 'network connection interrupted'
      })
    )

    const retry = await restartedManager.retryDownload(interrupted.entry.id)

    expect(retry).toEqual({ success: true })
    expect(retryRange).toBe(`bytes=${prefix.length}-`)
    expect(fs.readFileSync(interrupted.filePath)).toEqual(complete)
    expect(fs.existsSync(`${interrupted.filePath}.part`)).toBe(false)
    expect(await restartedManager.listInstalled()).toContain(interrupted.entry.id)

    vi.resetModules()
    const finalRestart = await import('../../models-manager')
    expect(finalRestart.listDownloads().map((download) => download.modelId)).not.toContain(
      interrupted.entry.id
    )
  })
})
