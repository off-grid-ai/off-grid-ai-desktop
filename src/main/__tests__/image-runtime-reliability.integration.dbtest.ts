/**
 * Real image-runtime reliability integration.
 *
 * Production LLMService, imagegen, ModalityQueue, runtime-manager, SQLite
 * residency, argument building, process lifecycle, and HTTP transports remain
 * real. Only the bundled native executables and reported host RAM are controlled.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

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
fs.appendFileSync(process.env.OFFGRID_TEST_LLAMA_LOG, 'start\\n')
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

  const [{ llm: productionLlm }, { generateImage: productionGenerateImage }, runtimeManager] =
    await Promise.all([import('../llm'), import('../imagegen'), import('../runtime-manager')])
  llm = productionLlm
  generateImage = productionGenerateImage
  runtimeManager.registerRuntime(llm.runtime)
  await llm.init()
})

afterAll(() => {
  llm.stop()
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
})
