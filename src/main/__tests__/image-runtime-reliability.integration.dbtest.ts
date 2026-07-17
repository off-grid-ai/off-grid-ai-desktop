/**
 * Real image-runtime reliability integration.
 *
 * Production LLMService, imagegen, ModalityQueue, runtime-manager, SQLite
 * residency, argument building, process lifecycle, and HTTP transports remain
 * real. Only the bundled native executables and reported host RAM are controlled.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import type { AddressInfo } from 'node:net'
import { LLAMA_SERVER_PORT } from '../../shared/ports'

const hostFetch = globalThis.fetch.bind(globalThis)

const fixture = (() => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'offgrid-image-runtime-'))
  return {
    root,
    dataDir: path.join(root, 'data'),
    binDir: path.join(root, 'bin'),
    llamaLog: path.join(root, 'llama-starts.log'),
    imageLog: path.join(root, 'image-runs.log')
  }
})()

vi.mock('electron', () => ({
  app: {
    getPath: () => fixture.dataDir,
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

const CHAT_MODEL = 'chat-runtime-fixture.gguf'
const IMAGE_MODEL = 'image-runtime-fixture.safetensors'
const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='

let llm: typeof import('../llm').llm
let generateImage: typeof import('../imagegen').generateImage
let startModelServer: typeof import('../model-server').startModelServer
let stopModelServer: typeof import('../model-server').stopModelServer
let gatewayPort: number

function executablePath(...parts: string[]): string {
  return path.join(fixture.binDir, ...parts)
}

function installFakeLlamaBoundary(): void {
  const executable = executablePath('llama', 'llama-server')
  fs.mkdirSync(path.dirname(executable), { recursive: true })
  fs.writeFileSync(
    executable,
    `#!/usr/bin/env node
const fs = require('node:fs')
const http = require('node:http')
const args = process.argv.slice(2)
const port = Number(args[args.indexOf('--port') + 1])
fs.appendFileSync(process.env.OFFGRID_TEST_LLAMA_LOG, 'start ' + process.pid + '\\n')
const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end('{"status":"ok"}')
    return
  }
  if (req.method === 'GET' && req.url === '/v1/models') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end('{"data":[{"id":"runtime-fixture"}]}')
    return
  }
  if (req.method === 'POST' && req.url === '/test/crash') {
    res.writeHead(200, { 'Content-Type': 'text/plain' })
    res.end('crashing', () => setTimeout(() => process.exit(23), 25))
    return
  }
  if (req.method === 'POST' && req.url === '/v1/chat/completions') {
    req.resume()
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end('{"choices":[{"message":{"content":"chat recovered"}}],"usage":{"total_tokens":2}}')
    })
    return
  }
  res.writeHead(404)
  res.end()
})
server.listen(port, '127.0.0.1')
`
  )
  fs.chmodSync(executable, 0o755)
}

function installFakeImageBoundary(): void {
  const executable = executablePath('sd', 'sd-cli')
  fs.mkdirSync(path.dirname(executable), { recursive: true })
  fs.writeFileSync(
    executable,
    `#!/usr/bin/env node
const fs = require('node:fs')
const args = process.argv.slice(2)
const value = (flag) => args[args.indexOf(flag) + 1]
fs.appendFileSync(process.env.OFFGRID_TEST_IMAGE_LOG, 'run\\n')
fs.writeFileSync(value('-o'), Buffer.from('${PNG_BASE64}', 'base64'))
`
  )
  fs.chmodSync(executable, 0o755)
}

function createValidGguf(filePath: string): void {
  const bytes = Buffer.alloc(2048)
  bytes.write('GGUF')
  fs.writeFileSync(filePath, bytes)
}

function lineCount(filePath: string): number {
  try {
    return fs.readFileSync(filePath, 'utf8').trim().split(/\r?\n/).filter(Boolean).length
  } catch {
    return 0
  }
}

function startedProcessIds(): number[] {
  try {
    return fs
      .readFileSync(fixture.llamaLog, 'utf8')
      .trim()
      .split(/\r?\n/)
      .map((line) => Number(line.split(' ')[1]))
      .filter(Number.isInteger)
  } catch {
    return []
  }
}

async function unusedPort(): Promise<number> {
  const probe = http.createServer()
  await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve))
  const port = (probe.address() as AddressInfo).port
  await new Promise<void>((resolve) => probe.close(() => resolve()))
  return port
}

async function waitFor(
  condition: () => boolean | Promise<boolean>,
  label: string,
  timeout = 8_000
): Promise<void> {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (await condition()) return
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error(`Timed out waiting for ${label}`)
}

async function portIsAvailable(port: number): Promise<boolean> {
  const probe = http.createServer()
  return new Promise((resolve) => {
    probe.once('error', () => resolve(false))
    probe.listen(port, '0.0.0.0', () => probe.close(() => resolve(true)))
  })
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function installOfflineReachabilityBoundary(): void {
  vi.stubGlobal('fetch', (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const target = new URL(
      typeof input === 'string' || input instanceof URL ? input.toString() : input.url
    )
    if (target.protocol === 'http:' && target.hostname === '127.0.0.1') {
      return hostFetch(input, init)
    }
    throw new TypeError('network unavailable in offline integration fixture')
  }) satisfies typeof fetch)
}

beforeAll(async () => {
  process.env.OFFGRID_DATA_DIR = fixture.dataDir
  process.env.OFFGRID_BIN_DIR = fixture.binDir
  process.env.OFFGRID_TEST_LLAMA_LOG = fixture.llamaLog
  process.env.OFFGRID_TEST_IMAGE_LOG = fixture.imageLog

  const modelsDir = path.join(fixture.dataDir, 'models')
  fs.mkdirSync(modelsDir, { recursive: true })
  createValidGguf(path.join(modelsDir, CHAT_MODEL))
  fs.writeFileSync(path.join(modelsDir, IMAGE_MODEL), 'image checkpoint')
  fs.writeFileSync(
    path.join(modelsDir, 'active-model.json'),
    JSON.stringify({ id: 'runtime-fixture', primary: CHAT_MODEL })
  )
  installFakeLlamaBoundary()
  installFakeImageBoundary()
  installOfflineReachabilityBoundary()

  const [
    { llm: productionLlm },
    { generateImage: productionGenerateImage },
    runtimeManager,
    modelServer
  ] = await Promise.all([
    import('../llm'),
    import('../imagegen'),
    import('../runtime-manager'),
    import('../model-server')
  ])
  llm = productionLlm
  generateImage = productionGenerateImage
  startModelServer = modelServer.startModelServer
  stopModelServer = modelServer.stopModelServer
  runtimeManager.registerRuntime(llm.runtime)
  await llm.init()
  gatewayPort = await unusedPort()
})

afterAll(async () => {
  const ownedProcessIds = startedProcessIds()
  stopModelServer()
  llm.stop()
  await waitFor(
    async () => (await portIsAvailable(gatewayPort)) && (await portIsAvailable(LLAMA_SERVER_PORT)),
    'owned model ports to be released'
  )
  await waitFor(
    () => ownedProcessIds.every((pid) => !processIsAlive(pid)),
    'native model processes to exit'
  )
  vi.unstubAllGlobals()
  delete process.env.OFFGRID_DATA_DIR
  delete process.env.OFFGRID_BIN_DIR
  delete process.env.OFFGRID_TEST_LLAMA_LOG
  delete process.env.OFFGRID_TEST_IMAGE_LOG
  fs.rmSync(fixture.root, { recursive: true, force: true })
})

describe('image runtime reliability', () => {
  it('evicts a resident chat runtime for image generation and reloads it for the next chat', async () => {
    expect(await llm.chat('before image')).toBe('chat recovered')
    expect(lineCount(fixture.llamaLog)).toBe(1)

    const image = await generateImage({
      prompt: 'A green cabin under stars',
      model: IMAGE_MODEL,
      seed: 314,
      width: 512,
      height: 512,
      steps: 4
    })
    expect(image.dataUrl).toBe(`data:image/png;base64,${PNG_BASE64}`)

    expect(await llm.chat('after image')).toBe('chat recovered')
    expect(lineCount(fixture.llamaLog)).toBe(2)
  })

  it('refuses an over-budget image model before the native runtime executes', async () => {
    const imageRunsBefore = lineCount(fixture.imageLog)
    const imagePath = path.join(fixture.dataDir, 'models', IMAGE_MODEL)
    fs.truncateSync(imagePath, 5_000_000_000)
    const totalMemory = vi.spyOn(os, 'totalmem').mockReturnValue(8_000_000_000)

    try {
      await expect(
        generateImage({ prompt: 'This must not execute', model: IMAGE_MODEL })
      ).rejects.toThrow(
        `Not enough memory to run ${IMAGE_MODEL} (~7.0GB resident) on this 8GB machine. Pick a lighter image model`
      )
    } finally {
      totalMemory.mockRestore()
    }

    expect(lineCount(fixture.imageLog)).toBe(imageRunsBefore)
    expect(await llm.chat('after guarded refusal')).toBe('chat recovered')
  })

  it('keeps local chat usable when external network reachability is unavailable', async () => {
    startModelServer(gatewayPort)
    await expect(fetch('https://example.invalid/health')).rejects.toThrow(
      'network unavailable in offline integration fixture'
    )

    const response = await fetch(`http://127.0.0.1:${String(gatewayPort)}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'active',
        messages: [{ role: 'user', content: 'Work without internet' }]
      })
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      choices: [{ message: { content: 'chat recovered' } }]
    })
  })

  it('coalesces concurrent cold starts into one native model process', async () => {
    const startsBefore = lineCount(fixture.llamaLog)
    llm.stop()

    await Promise.all(Array.from({ length: 12 }, () => llm.init()))

    expect(llm.isReady()).toBe(true)
    expect(lineCount(fixture.llamaLog) - startsBefore).toBe(1)
    startModelServer(gatewayPort)
    const health = await fetch(`http://127.0.0.1:${String(gatewayPort)}/v1`)
    expect(health.status).toBe(200)
  })

  it('recovers after an unexpected native engine crash', async () => {
    const startsBefore = lineCount(fixture.llamaLog)
    const crash = await fetch(`http://127.0.0.1:${String(LLAMA_SERVER_PORT)}/test/crash`, {
      method: 'POST'
    })
    expect(crash.status).toBe(200)

    await waitFor(() => !llm.isReady(), 'the crashed engine to be marked down')
    const responsePromise = fetch(`http://127.0.0.1:${String(gatewayPort)}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'active',
        messages: [{ role: 'user', content: 'Reply after restart' }]
      })
    })
    await waitFor(
      () => lineCount(fixture.llamaLog) > startsBefore && llm.isReady(),
      'the local model engine to recover'
    )
    expect(lineCount(fixture.llamaLog) - startsBefore).toBe(1)

    const response = await responsePromise
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      choices: [{ message: { content: 'chat recovered' } }]
    })
  }, 10_000)
})
