#!/usr/bin/env node
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const app = process.argv[2]
if (!app || !fs.statSync(app, { throwIfNoEntry: false })?.isDirectory()) {
  process.stderr.write('usage: node scripts/probe-packaged-tts.mjs <path-to.app>\n')
  process.exit(2)
}

const executableName = path.basename(app, '.app')
const executable = path.join(app, 'Contents', 'MacOS', executableName)
const worker = path.join(app, 'Contents', 'Resources', 'app.asar', 'out', 'main', 'tts-worker.js')
const env = { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
delete env.ELECTRON_NO_ASAR

const result = spawnSync(executable, [worker, 'probe'], {
  env,
  encoding: 'utf8',
  maxBuffer: 10 * 1024 * 1024,
  timeout: 30_000
})

let payload
try {
  payload = JSON.parse(result.stdout.trim())
} catch {
  payload = null
}
const expectedTermination = result.signal === 'SIGKILL' || result.status === 137
if (!expectedTermination || payload?.kokoro !== true) {
  process.stderr.write(
    [
      '[tts-probe] packaged worker failed',
      `status=${String(result.status)} signal=${String(result.signal)}`,
      `stdout=${result.stdout.trim()}`,
      `stderr=${result.stderr.trim()}`
    ].join('\n') + '\n'
  )
  process.exit(1)
}

process.stdout.write('[tts-probe] packaged ASAR worker resolved kokoro-js\n')

if (process.argv.includes('--synthesize')) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'offgrid-packaged-tts-'))
  const wavPath = path.join(temp, 'proof.wav')
  try {
    const synthesisEnv = { ...env, OFFGRID_TTS_CACHE_DIR: path.join(temp, 'cache') }
    const synthesis = spawnSync(executable, [worker, 'speak', wavPath, 'af_heart'], {
      env: synthesisEnv,
      input: 'Off Grid speech is ready.',
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
      timeout: 120_000
    })
    if (!fs.existsSync(wavPath)) {
      throw new Error(
        `worker produced no WAV: status=${String(synthesis.status)} signal=${String(synthesis.signal)} stderr=${synthesis.stderr.trim()}`
      )
    }
    const wav = fs.readFileSync(wavPath)
    let energy = 0
    for (let offset = 44; offset + 1 < wav.length; offset += 2) {
      energy += Math.abs(wav.readInt16LE(offset))
    }
    const valid =
      (synthesis.signal === 'SIGKILL' || synthesis.status === 137) &&
      wav.toString('ascii', 0, 4) === 'RIFF' &&
      wav.toString('ascii', 8, 12) === 'WAVE' &&
      wav.readUInt16LE(20) === 1 &&
      wav.readUInt16LE(22) === 1 &&
      wav.readUInt32LE(24) === 24_000 &&
      wav.readUInt16LE(34) === 16 &&
      wav.length > 44 &&
      energy > 0
    if (!valid) {
      throw new Error(
        `invalid synthesis: status=${String(synthesis.status)} signal=${String(synthesis.signal)} bytes=${wav.length} energy=${energy} stderr=${synthesis.stderr.trim()}`
      )
    }
    process.stdout.write(
      `[tts-probe] synthesized ${wav.length} bytes of non-zero PCM16 mono 24kHz audio\n`
    )
  } finally {
    fs.rmSync(temp, { recursive: true, force: true })
  }
}
