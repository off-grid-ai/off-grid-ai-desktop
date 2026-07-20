import fs from 'node:fs'
import path from 'node:path'
import { dataDir } from './runtime-env'

export type DiagnosticLevel = 'info' | 'warn' | 'error'
export type DiagnosticValue = string | number | boolean | null | undefined

const MAX_LOG_BYTES = 5 * 1024 * 1024
const MAX_VALUE_CHARS = 1_500
const SECRET_VALUE =
  /((?:authorization|password|passwd|token|secret|api[-_ ]?key|cookie)["']?\s*[:=]\s*["']?)([^\s,"'}]+)/gi
const BEARER_VALUE = /(bearer\s+)[a-z0-9._~+/=-]+/gi

function redact(value: string): string {
  return value.replace(SECRET_VALUE, '$1[redacted]').replace(BEARER_VALUE, '$1[redacted]')
}

function cleanValue(value: DiagnosticValue): string | null {
  if (value === undefined) return null
  if (value === null) return 'null'
  if (typeof value !== 'string') return String(value)
  return JSON.stringify(
    redact(value)
      .replace(/[\r\n\t]+/g, ' ')
      .slice(0, MAX_VALUE_CHARS)
  )
}

/** One readable, grep-friendly line. Callers pass operational metadata only, never user content. */
export function formatDiagnosticLog(
  timestamp: string,
  level: DiagnosticLevel,
  component: string,
  event: string,
  fields: Record<string, DiagnosticValue> = {}
): string {
  const details = Object.entries(fields)
    .map(([key, value]) => {
      const clean = cleanValue(value)
      return clean === null ? null : `${key}=${clean}`
    })
    .filter((value): value is string => value !== null)
    .join(' ')
  return `${timestamp} ${level.toUpperCase()} [${component}] ${event}${details ? ` ${details}` : ''}`
}

export function diagnosticLogPath(): string {
  return (
    process.env.OFFGRID_DIAGNOSTIC_LOG || path.join(dataDir(), 'logs', 'off-grid-ai-desktop.log')
  )
}

function rotateIfNeeded(logPath: string): void {
  try {
    if (fs.statSync(logPath).size < MAX_LOG_BYTES) return
    const previous = `${logPath}.previous`
    fs.rmSync(previous, { force: true })
    fs.renameSync(logPath, previous)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
}

function persistLine(line: string): void {
  const logPath = diagnosticLogPath()
  fs.mkdirSync(path.dirname(logPath), { recursive: true })
  rotateIfNeeded(logPath)
  fs.appendFileSync(logPath, `${line}\n`, { encoding: 'utf8', mode: 0o600 })
  fs.chmodSync(logPath, 0o600)
}

function consoleValue(value: unknown): string {
  if (value instanceof Error) return redact(value.stack || value.message)
  if (typeof value === 'string') return redact(value)
  if (value === null || value === undefined || typeof value !== 'object') return String(value)
  try {
    return redact(
      JSON.stringify(value, (key, item: unknown) =>
        /authorization|password|passwd|token|secret|api[-_ ]?key|cookie/i.test(key)
          ? '[redacted]'
          : item
      )
    )
  } catch {
    return `[${Object.prototype.toString.call(value)}]`
  }
}

export function formatConsoleMessage(values: unknown[]): string {
  return values
    .map(consoleValue)
    .join(' ')
    .replace(/[\r\n\t]+/g, ' ')
    .slice(0, MAX_VALUE_CHARS)
}

/** Persist a diagnostic event and mirror it to the process stream for terminal runs. */
export function writeDiagnosticLog(
  component: string,
  event: string,
  fields: Record<string, DiagnosticValue> = {},
  level: DiagnosticLevel = 'info'
): void {
  const line = formatDiagnosticLog(new Date().toISOString(), level, component, event, fields)
  try {
    persistLine(line)
  } catch (error) {
    process.stderr.write(
      `${formatDiagnosticLog(new Date().toISOString(), 'error', 'diagnostics', 'write.failed', {
        error: error instanceof Error ? error.message : String(error)
      })}\n`
    )
  }
  const stream = level === 'error' ? process.stderr : process.stdout
  stream.write(`${line}\n`)
}

let consoleCaptureInstalled = false

/** Capture every existing main-process console event in the private rotating log. */
export function installDiagnosticConsoleCapture(): void {
  if (consoleCaptureInstalled) return
  consoleCaptureInstalled = true
  const methods: Array<{
    name: 'log' | 'info' | 'debug' | 'warn' | 'error'
    level: DiagnosticLevel
  }> = [
    { name: 'log', level: 'info' },
    { name: 'info', level: 'info' },
    { name: 'debug', level: 'info' },
    { name: 'warn', level: 'warn' },
    { name: 'error', level: 'error' }
  ]
  for (const { name, level } of methods) {
    const original = console[name].bind(console)
    console[name] = (...values: unknown[]): void => {
      original(...values)
      try {
        persistLine(
          formatDiagnosticLog(new Date().toISOString(), level, 'app', 'console', {
            message: formatConsoleMessage(values)
          })
        )
      } catch {
        // Diagnostics must never take down the application it is observing.
      }
    }
  }
  writeDiagnosticLog('diagnostics', 'capture.installed', { logPath: diagnosticLogPath() })
}
