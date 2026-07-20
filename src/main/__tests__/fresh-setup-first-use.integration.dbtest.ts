/**
 * Fresh-install release journey through the production setup planner, catalog,
 * model manager, persisted selections, and the three baseline runtime owners.
 *
 * Only boundaries outside Off Grid are controlled: HTTP serves deterministic
 * model bytes and tiny executables stand in for llama.cpp, whisper.cpp, and
 * Kokoro. The interrupted-download registry, Range resume, filesystem promotion,
 * activation, runtime selection, first use, and relaunch behavior stay real.
 */
import { afterAll, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const originalDataDir = process.env.OFFGRID_DATA_DIR
const originalBinDir = process.env.OFFGRID_BIN_DIR
const originalResourceDir = process.env.OFFGRID_RESOURCE_DIR
const hostFetch = globalThis.fetch.bind(globalThis)
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'offgrid-fresh-setup-'))
const dataDir = path.join(root, 'profile')
const binDir = path.join(root, 'bin')
const resourceDir = path.join(root, 'resources')
process.env.OFFGRID_DATA_DIR = dataDir
process.env.OFFGRID_BIN_DIR = binDir
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

interface CatalogFile {
  name: string
  url: string
}

interface BaselineModel {
  id: string
  kind: 'chat' | 'transcription' | 'voice'
  files: CatalogFile[]
}

const delivery = new Map<string, Buffer>()
const interrupted = new Set<string>()
const resumedRanges = new Map<string, string>()
let interruptDownloads = true
let remoteRequests = 0

function executable(file: string, source: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, source, { mode: 0o755 })
}

function installRuntimeBoundaries(): void {
  executable(
    path.join(binDir, 'llama', 'llama-server'),
    [
      '#!/usr/bin/env node',
      "const http = require('node:http')",
      'const args = process.argv.slice(2)',
      "const portIndex = args.indexOf('--port')",
      'const port = portIndex >= 0 ? Number(args[portIndex + 1]) : 8439',
      'const server = http.createServer((req, res) => {',
      "  if (req.method === 'GET' && req.url === '/health') {",
      "    res.writeHead(200, { 'content-type': 'application/json' })",
      "    res.end(JSON.stringify({ status: 'ok' }))",
      '    return',
      '  }',
      "  if (req.method === 'GET' && req.url === '/v1/models') {",
      "    res.writeHead(200, { 'content-type': 'application/json' })",
      "    res.end(JSON.stringify({ data: [{ id: 'fresh-setup-model' }] }))",
      '    return',
      '  }',
      "  if (req.method === 'POST' && req.url === '/v1/chat/completions') {",
      "    let body = ''",
      "    req.setEncoding('utf8')",
      "    req.on('data', chunk => { body += chunk })",
      "    req.on('end', () => {",
      '      JSON.parse(body)',
      "      res.writeHead(200, { 'content-type': 'application/json', connection: 'close' })",
      "      res.end(JSON.stringify({ choices: [{ message: { content: 'fresh setup chat ready' } }], usage: { total_tokens: 4 } }))",
      '    })',
      '    return',
      '  }',
      '  res.writeHead(404)',
      '  res.end()',
      '})',
      "server.listen(port, '127.0.0.1')",
      "process.on('SIGTERM', () => server.close(() => process.exit(0)))",
      "process.on('SIGINT', () => server.close(() => process.exit(0)))"
    ].join('\n')
  )
  executable(
    path.join(binDir, 'whisper', 'whisper-cli'),
    "#!/bin/sh\nprintf '%s\\n' 'fresh setup transcription ready'\n"
  )
  fs.mkdirSync(resourceDir, { recursive: true })
  fs.writeFileSync(
    path.join(resourceDir, 'tts-worker.mjs'),
    [
      "import fs from 'node:fs'",
      'const [, , command, output] = process.argv',
      "if (command === 'speak' && output) {",
      "  let input = ''",
      "  process.stdin.setEncoding('utf8')",
      "  process.stdin.on('data', chunk => { input += chunk })",
      "  process.stdin.on('end', () => {",
      "    fs.writeFileSync(output, Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(60, 1)]))",
      '  })',
      '}'
    ].join('\n'),
    { mode: 0o755 }
  )
}

function fixtureBytes(fileName: string, seed: number): Buffer {
  if (fileName.endsWith('.gguf')) {
    return Buffer.concat([Buffer.from('GGUF', 'ascii'), Buffer.alloc(2_044, seed)])
  }
  return Buffer.concat([Buffer.from(`off-grid-${fileName}-`), Buffer.alloc(2_048, seed)])
}

function installDownloadBoundary(models: BaselineModel[]): void {
  models.forEach((model, modelIndex) => {
    model.files.forEach((file, fileIndex) => {
      delivery.set(file.url, fixtureBytes(file.name, modelIndex * 10 + fileIndex + 1))
    })
  })
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      const bytes = delivery.get(url)
      if (!bytes) return hostFetch(input, init)
      remoteRequests++

      const range = new Headers(init?.headers).get('range')
      if (range) {
        resumedRanges.set(url, range)
        const offset = Number(/^bytes=(\d+)-$/.exec(range)?.[1] ?? 0)
        const suffix = bytes.subarray(offset)
        return new Response(new Uint8Array(suffix), {
          status: 206,
          headers: { 'content-length': String(suffix.length) }
        })
      }

      if (interruptDownloads && !interrupted.has(url)) {
        interrupted.add(url)
        const prefix = bytes.subarray(0, Math.min(700, bytes.length - 1))
        let pull = 0
        const body = new ReadableStream<Uint8Array>({
          pull(controller) {
            if (pull++ === 0) {
              controller.enqueue(prefix)
              return
            }
            controller.error(new Error('network connection interrupted'))
          }
        })
        return new Response(body, {
          status: 200,
          headers: { 'content-length': String(bytes.length) }
        })
      }

      return new Response(new Uint8Array(bytes), {
        status: 200,
        headers: { 'content-length': String(bytes.length) }
      })
    })
  )
}

async function waitForPortRelease(port: number): Promise<void> {
  const deadline = Date.now() + 2_000
  while (Date.now() < deadline) {
    try {
      await fetch(`http://127.0.0.1:${port}/health`)
    } catch {
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  throw new Error(`runtime boundary still owns port ${port}`)
}

function expectWav(dataUrl: string): void {
  expect(dataUrl).toMatch(/^data:audio\/wav;base64,/)
  expect(Buffer.from(dataUrl.split(',')[1]!, 'base64').subarray(0, 4).toString('ascii')).toBe(
    'RIFF'
  )
}

afterAll(async () => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  try {
    const { llm } = await import('../llm')
    llm.stop()
  } catch {
    // A failed assertion can happen before the runtime module loads.
  }
  try {
    const database = await import('../database')
    database.getDB().close()
  } catch {
    // The profile may not have reached first TTS use.
  }
  if (originalDataDir === undefined) delete process.env.OFFGRID_DATA_DIR
  else process.env.OFFGRID_DATA_DIR = originalDataDir
  if (originalBinDir === undefined) delete process.env.OFFGRID_BIN_DIR
  else process.env.OFFGRID_BIN_DIR = originalBinDir
  if (originalResourceDir === undefined) delete process.env.OFFGRID_RESOURCE_DIR
  else process.env.OFFGRID_RESOURCE_DIR = originalResourceDir
  fs.rmSync(root, { recursive: true, force: true })
})

describe('fresh setup to first use', () => {
  it('resumes the full baseline, uses every selected runtime, and stays usable after relaunch', async () => {
    expect(fs.existsSync(dataDir)).toBe(false)
    installRuntimeBoundaries()

    const [{ llm }, setup, manager, { CATALOG }] = await Promise.all([
      import('../llm'),
      import('../setup'),
      import('../models-manager'),
      import('@offgrid/models')
    ])

    // This is the real settings owner. Fresh setup cannot start the model yet, but
    // the selected mode is persisted before that expected missing-model failure.
    await expect(llm.setSettings({ performanceMode: 'conservative' })).rejects.toThrow(
      'Models not downloaded'
    )
    const plan = await setup.getSetupPlan()
    expect(plan.mode).toBe('conservative')
    expect(plan.items.map((item) => item.kind)).toEqual(['chat', 'transcription', 'voice'])
    expect(plan.items.every((item) => item.installed === false)).toBe(true)

    const models: BaselineModel[] = plan.items.map((item) => {
      const catalogEntry = CATALOG.find((entry) => entry.id === item.id)
      if (!catalogEntry) throw new Error(`Setup selected a model outside the catalog: ${item.id}`)
      return {
        id: item.id,
        kind: item.kind as BaselineModel['kind'],
        files: catalogEntry.files.map((file) => ({ name: file.name, url: file.url }))
      }
    })
    installDownloadBoundary(models)

    // Each representative baseline download loses its connection after writing a
    // real .part prefix. No model is installed or selectable from partial bytes.
    for (const model of models) {
      await expect(manager.downloadModel(model.id)).resolves.toEqual({
        success: false,
        error: 'network connection interrupted'
      })
      const firstFile = model.files[0]!
      expect(fs.statSync(path.join(dataDir, 'models', `${firstFile.name}.part`)).size).toBe(700)
      expect(await manager.listInstalled()).not.toContain(model.id)
    }

    // Relaunch the module graph like a newly started main process. The production
    // registry restores every interrupted row, then Configure for me resumes them.
    vi.resetModules()
    interruptDownloads = false
    const [{ llm: resumedLlm }, resumedSetup, resumedManager] = await Promise.all([
      import('../llm'),
      import('../setup'),
      import('../models-manager')
    ])
    expect(resumedManager.listDownloads()).toEqual(
      expect.arrayContaining(
        models.map((model) =>
          expect.objectContaining({
            modelId: model.id,
            status: 'failed',
            error: 'network connection interrupted'
          })
        )
      )
    )

    const progress: import('../setup').SetupProgress[] = []
    await expect(
      resumedSetup.autoConfigure((event) => progress.push(event))
    ).resolves.toMatchObject({ success: true, modelId: models[0]!.id })
    expect(progress.at(-1)).toMatchObject({ phase: 'done', modelId: models[0]!.id })
    expect(await resumedManager.listInstalled()).toEqual(
      expect.arrayContaining(models.map((model) => model.id))
    )
    for (const model of models) {
      const firstFile = model.files[0]!
      expect(resumedRanges.get(firstFile.url)).toBe('bytes=700-')
      expect(fs.existsSync(path.join(dataDir, 'models', `${firstFile.name}.part`))).toBe(false)
    }

    const active = resumedManager.getActiveModalities()
    expect(active).toEqual({
      text: models.find((model) => model.kind === 'chat')!.id,
      image: null,
      transcription: models.find((model) => model.kind === 'transcription')!.id,
      speech: models.find((model) => model.kind === 'voice')!.id
    })

    expect(await resumedLlm.chat('Prove the fresh chat model can answer')).toBe(
      'fresh setup chat ready'
    )
    const { getActiveTranscription } = await import('../transcription/select')
    const syntheticAudio = path.join(root, 'synthetic.wav')
    fs.writeFileSync(syntheticAudio, Buffer.from('synthetic audio boundary'))
    await expect(
      getActiveTranscription().transcribe({ path: syntheticAudio }, { alreadyWav16k: true })
    ).resolves.toEqual({ text: 'fresh setup transcription ready', language: undefined })
    const { synthesize } = await import('../tts')
    expectWav((await synthesize('Fresh setup speech is ready')).dataUrl)

    const requestsAfterFirstUse = remoteRequests
    resumedLlm.stop()
    const database = await import('../database')
    database.getDB().close()
    await waitForPortRelease(8439)

    // A second relaunch must consume the exact persisted install and selections.
    // It must not repair or redownload anything to make first use work again.
    vi.resetModules()
    const [{ llm: relaunchedLlm }, relaunchedSetup, relaunchedManager] = await Promise.all([
      import('../llm'),
      import('../setup'),
      import('../models-manager')
    ])
    const relaunchedPlan = await relaunchedSetup.getSetupPlan()
    expect(relaunchedPlan.items.every((item) => item.installed)).toBe(true)
    expect(relaunchedPlan.totalDownloadGb).toBe(0)
    expect(relaunchedManager.getActiveModalities()).toEqual(active)
    expect(await relaunchedManager.getActiveModelIds()).toEqual(
      expect.arrayContaining(models.map((model) => model.id))
    )
    expect(await relaunchedLlm.chat('Prove the persisted chat model can answer')).toBe(
      'fresh setup chat ready'
    )
    const { getActiveTranscription: getRelaunchedTranscription } =
      await import('../transcription/select')
    await expect(
      getRelaunchedTranscription().transcribe({ path: syntheticAudio }, { alreadyWav16k: true })
    ).resolves.toEqual({ text: 'fresh setup transcription ready', language: undefined })
    const { synthesize: synthesizeAfterRelaunch } = await import('../tts')
    expectWav((await synthesizeAfterRelaunch('Persisted speech is ready')).dataUrl)
    expect(remoteRequests).toBe(requestsAfterFirstUse)

    relaunchedLlm.stop()
    await waitForPortRelease(8439)
    const relaunchedDatabase = await import('../database')
    relaunchedDatabase.getDB().close()
  })
})
