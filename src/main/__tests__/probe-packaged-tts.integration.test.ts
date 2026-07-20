import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const REPO_ROOT = path.resolve(import.meta.dirname, '../../..')
const PROBE = path.join(REPO_ROOT, 'scripts', 'probe-packaged-tts.mjs')
const WORKFLOW = path.join(REPO_ROOT, '.github', 'workflows', 'release.yml')
const tempRoots: string[] = []

interface FixtureOptions {
  silent?: boolean
}

function createPackagedAppFixture(options: FixtureOptions = {}): {
  app: string
  capture: string
} {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'offgrid-packaged-tts-probe-'))
  tempRoots.push(root)
  const app = path.join(root, 'Off Grid AI Desktop.app')
  const executable = path.join(app, 'Contents', 'MacOS', 'Off Grid AI Desktop')
  const worker = path.join(app, 'Contents', 'Resources', 'app.asar', 'out', 'main', 'tts-worker.js')
  const capture = path.join(root, 'invocations.ndjson')
  fs.mkdirSync(path.dirname(executable), { recursive: true })
  fs.mkdirSync(path.dirname(worker), { recursive: true })
  fs.writeFileSync(worker, '// packaged worker fixture\n')
  fs.writeFileSync(
    executable,
    `#!/usr/bin/env node
const fs = require('node:fs')
const [worker, mode, output, voice] = process.argv.slice(2)
let input = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => { input += chunk })
process.stdin.on('end', () => {
  fs.appendFileSync(process.env.OFFGRID_TTS_PROBE_CAPTURE, JSON.stringify({
    worker,
    mode,
    voice,
    input,
    runAsNode: process.env.ELECTRON_RUN_AS_NODE,
    electronNoAsar: process.env.ELECTRON_NO_ASAR ?? null,
    cacheDir: process.env.OFFGRID_TTS_CACHE_DIR ?? null
  }) + '\\n')
  if (mode === 'probe') {
    process.stdout.write(JSON.stringify({ kokoro: true }))
  } else if (mode === 'speak') {
    const samples = Buffer.alloc(4800)
    if (${JSON.stringify(!options.silent)}) samples.writeInt16LE(2048, 0)
    const wav = Buffer.alloc(44 + samples.length)
    wav.write('RIFF', 0)
    wav.writeUInt32LE(36 + samples.length, 4)
    wav.write('WAVE', 8)
    wav.write('fmt ', 12)
    wav.writeUInt32LE(16, 16)
    wav.writeUInt16LE(1, 20)
    wav.writeUInt16LE(1, 22)
    wav.writeUInt32LE(24000, 24)
    wav.writeUInt32LE(48000, 28)
    wav.writeUInt16LE(2, 32)
    wav.writeUInt16LE(16, 34)
    wav.write('data', 36)
    wav.writeUInt32LE(samples.length, 40)
    samples.copy(wav, 44)
    fs.writeFileSync(output, wav)
  }
  process.kill(process.pid, 'SIGKILL')
})
`,
    { mode: 0o755 }
  )
  return { app, capture }
}

function runProbe(app: string, capture: string): ReturnType<typeof spawnSync> {
  return spawnSync(process.execPath, [PROBE, app, '--synthesize'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env: { ...process.env, OFFGRID_TTS_PROBE_CAPTURE: capture },
    timeout: 10_000
  })
}

afterEach(() => {
  while (tempRoots.length > 0) {
    fs.rmSync(tempRoots.pop()!, { recursive: true, force: true })
  }
})

describe('packaged TTS release probe', () => {
  it('runs the exact ASAR worker headlessly and requires non-zero PCM synthesis', () => {
    const { app, capture } = createPackagedAppFixture()
    const result = runProbe(app, capture)

    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0)
    expect(result.stdout).toContain('packaged ASAR worker resolved kokoro-js')
    expect(result.stdout).toContain('non-zero PCM16 mono 24kHz audio')

    const invocations = fs
      .readFileSync(capture, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as Record<string, unknown>)
    expect(invocations).toHaveLength(2)
    expect(invocations[0]).toMatchObject({
      worker: path.join(app, 'Contents', 'Resources', 'app.asar', 'out', 'main', 'tts-worker.js'),
      mode: 'probe',
      runAsNode: '1',
      electronNoAsar: null
    })
    expect(invocations[1]).toMatchObject({
      worker: path.join(app, 'Contents', 'Resources', 'app.asar', 'out', 'main', 'tts-worker.js'),
      mode: 'speak',
      voice: 'af_heart',
      input: 'Off Grid speech is ready.',
      runAsNode: '1',
      electronNoAsar: null
    })
    expect(invocations[1]!.cacheDir).toMatch(/offgrid-packaged-tts-.*[\\/]cache$/)
  })

  it('rejects a structurally valid WAV with no sample energy', () => {
    const { app, capture } = createPackagedAppFixture({ silent: true })
    const result = runProbe(app, capture)

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('invalid synthesis')
    expect(result.stderr).toContain('energy=0')
  })

  it('runs real synthesis after packaging and before any release upload', () => {
    const workflow = fs.readFileSync(WORKFLOW, 'utf8')
    const packageIndex = workflow.indexOf('npx electron-builder --mac')
    const probeIndex = workflow.indexOf('node scripts/probe-packaged-tts.mjs "$APP" --synthesize')
    const publishIndex = workflow.indexOf('Stage verified update assets and publish the release')

    expect(packageIndex).toBeGreaterThanOrEqual(0)
    expect(probeIndex).toBeGreaterThan(packageIndex)
    expect(publishIndex).toBeGreaterThan(probeIndex)
    expect(workflow.slice(packageIndex, publishIndex)).toContain('--publish never')
  })
})
