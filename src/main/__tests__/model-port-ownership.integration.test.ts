/**
 * RELEASE_TEST_CHECKLIST #146 - fixed model ports are single-owner.
 *
 * A separate live owner process launches the only fake: a behaviour-faithful native
 * llama-server boundary on the real production port. The contender is the production
 * LLMService. Real lsof/ps parent ownership, loopback HTTP, GGUF validation, model resolution,
 * startup refusal, error classification, and chat-health presentation remain real.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { LLAMA_SERVER_PORT } from '../../shared/ports'

const fixture = (() => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'offgrid-port-owner-'))
  return {
    root,
    dataDir: path.join(root, 'data'),
    binDir: path.join(root, 'bin'),
    engineLog: path.join(root, 'engine.log')
  }
})()
const previousDataDir = process.env.OFFGRID_DATA_DIR
const previousBinDir = process.env.OFFGRID_BIN_DIR
process.env.OFFGRID_DATA_DIR = fixture.dataDir
process.env.OFFGRID_BIN_DIR = fixture.binDir

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

let liveOwner: ChildProcess | null = null
let enginePid = 0

function createValidGguf(filePath: string): void {
  const bytes = Buffer.alloc(2_048)
  bytes.write('GGUF')
  fs.writeFileSync(filePath, bytes)
}

function installNativeBoundary(): string {
  const executable = path.join(fixture.binDir, 'llama', 'llama-server')
  fs.mkdirSync(path.dirname(executable), { recursive: true })
  fs.writeFileSync(
    executable,
    `#!/usr/bin/env node
const fs = require('node:fs')
const http = require('node:http')
const args = process.argv.slice(2)
const port = Number(args[args.indexOf('--port') + 1])
fs.appendFileSync(process.env.OFFGRID_TEST_ENGINE_LOG, String(process.pid) + '\\n')
const server = http.createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json')
  if (req.url === '/health') return res.end('{"status":"ok"}')
  if (req.url === '/v1/models') return res.end('{"data":[{"id":"first-owner"}]}')
  res.statusCode = 404
  res.end('{}')
})
server.listen(port, '127.0.0.1')
process.on('SIGTERM', () => server.close(() => process.exit(0)))
`
  )
  fs.chmodSync(executable, 0o755)
  return executable
}

async function waitFor(
  condition: () => boolean | Promise<boolean>,
  label: string,
  timeout = 5_000
): Promise<void> {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (await condition()) return
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error(`Timed out waiting for ${label}`)
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function engineIsReady(): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${LLAMA_SERVER_PORT}/v1/models`)
    const body = (await response.json()) as { data?: { id?: string }[] }
    return response.ok && body.data?.[0]?.id === 'first-owner'
  } catch {
    return false
  }
}

beforeAll(async () => {
  const modelsDir = path.join(fixture.dataDir, 'models')
  fs.mkdirSync(modelsDir, { recursive: true })
  const modelName = 'port-owner-fixture.gguf'
  createValidGguf(path.join(modelsDir, modelName))
  fs.writeFileSync(
    path.join(modelsDir, 'active-model.json'),
    JSON.stringify({ id: 'port-owner-fixture', primary: modelName })
  )

  const executable = installNativeBoundary()
  const ownerSource = `
const { spawn } = require('node:child_process')
const child = spawn(process.env.OFFGRID_TEST_ENGINE, ['--port', process.env.OFFGRID_TEST_PORT], {
  env: process.env,
  stdio: 'ignore'
})
process.on('SIGTERM', () => child.kill('SIGTERM'))
child.on('exit', (code) => process.exit(code || 0))
setInterval(() => {}, 1000)
`
  liveOwner = spawn(process.execPath, ['-e', ownerSource], {
    env: {
      ...process.env,
      OFFGRID_TEST_ENGINE: executable,
      OFFGRID_TEST_ENGINE_LOG: fixture.engineLog,
      OFFGRID_TEST_PORT: String(LLAMA_SERVER_PORT)
    },
    stdio: 'ignore'
  })
  await waitFor(engineIsReady, 'first model engine owner')
  enginePid = Number(fs.readFileSync(fixture.engineLog, 'utf8').trim())
})

afterAll(async () => {
  liveOwner?.kill('SIGTERM')
  if (enginePid > 0) {
    await waitFor(() => !processIsAlive(enginePid), 'first model engine to exit')
  }
  if (previousDataDir === undefined) delete process.env.OFFGRID_DATA_DIR
  else process.env.OFFGRID_DATA_DIR = previousDataDir
  if (previousBinDir === undefined) delete process.env.OFFGRID_BIN_DIR
  else process.env.OFFGRID_BIN_DIR = previousBinDir
  fs.rmSync(fixture.root, { recursive: true, force: true })
})

describe('model port ownership', () => {
  it('preserves the first live engine and explains the second-instance conflict (#146)', async () => {
    const [{ llm }, { getSystemHealth }, { modelPortConflictReason }] = await Promise.all([
      import('../llm'),
      import('../setup'),
      import('../llama-error')
    ])
    const conflict = modelPortConflictReason(LLAMA_SERVER_PORT)

    await expect(llm.init()).rejects.toThrow(conflict)
    expect(llm.isReady()).toBe(false)
    expect(llm.isStarting()).toBe(false)
    expect(llm.lastError()).toBe(conflict)

    expect(processIsAlive(enginePid)).toBe(true)
    expect(await engineIsReady()).toBe(true)
    expect(fs.readFileSync(fixture.engineLog, 'utf8').trim().split(/\r?\n/)).toEqual([
      String(enginePid)
    ])

    const chatHealth = (await getSystemHealth()).components.find(
      (component) => component.id === 'chat'
    )
    expect(chatHealth).toMatchObject({ status: 'down', detail: conflict, port: LLAMA_SERVER_PORT })
  })
})
