#!/usr/bin/env node
import { spawn } from 'node:child_process'

const [, , timeoutValue, executable, ...args] = process.argv
const timeoutMs = Number(timeoutValue)

if (!executable || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
  console.error('usage: exec-with-timeout.mjs <milliseconds> <executable> [args...]')
  process.exit(2)
}

const child = spawn(executable, args, { stdio: 'inherit' })
let timedOut = false
let forceKillTimer

const timeout = setTimeout(() => {
  timedOut = true
  child.kill('SIGTERM')
  forceKillTimer = setTimeout(() => child.kill('SIGKILL'), 5_000)
}, timeoutMs)

child.once('error', (error) => {
  clearTimeout(timeout)
  if (forceKillTimer) clearTimeout(forceKillTimer)
  console.error(`[timeout] failed to start ${executable}: ${error.message}`)
  process.exit(127)
})

child.once('exit', (code, signal) => {
  clearTimeout(timeout)
  if (forceKillTimer) clearTimeout(forceKillTimer)
  if (timedOut) {
    console.error(`[timeout] ${executable} exceeded ${timeoutMs}ms`)
    process.exit(124)
  }
  if (signal) {
    console.error(`[timeout] ${executable} exited from signal ${signal}`)
    process.exit(1)
  }
  process.exit(code ?? 1)
})
