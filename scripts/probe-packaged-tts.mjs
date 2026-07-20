#!/usr/bin/env node
import fs from 'node:fs'
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
