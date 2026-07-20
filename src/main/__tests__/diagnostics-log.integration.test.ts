import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { formatDiagnosticLog, writeDiagnosticLog } from '../diagnostics-log'
import { formatConsoleMessage } from '../diagnostics-log'

const originalLogPath = process.env.OFFGRID_DIAGNOSTIC_LOG
const roots: string[] = []

afterEach(() => {
  if (originalLogPath === undefined) delete process.env.OFFGRID_DIAGNOSTIC_LOG
  else process.env.OFFGRID_DIAGNOSTIC_LOG = originalLogPath
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

describe('diagnostic log', () => {
  it('formats metadata as one readable line without multiline injection', () => {
    expect(
      formatDiagnosticLog('2026-07-20T00:00:00.000Z', 'info', 'tts', 'worker.started', {
        mode: 'on-demand',
        chars: 42,
        detail: 'first\nsecond',
        omitted: undefined
      })
    ).toBe(
      '2026-07-20T00:00:00.000Z INFO [tts] worker.started mode="on-demand" chars=42 detail="first second"'
    )
  })

  it('redacts credentials from legacy console events before persistence', () => {
    expect(
      formatConsoleMessage([
        'download failed token=private-token',
        { model: 'kokoro', apiKey: 'private-key', progress: 42 }
      ])
    ).toBe(
      'download failed token=[redacted] {"model":"kokoro","apiKey":"[redacted]","progress":42}'
    )
  })

  it('writes consecutive events to the configured private log file', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'offgrid-diagnostics-'))
    roots.push(root)
    const logPath = path.join(root, 'nested', 'desktop.log')
    process.env.OFFGRID_DIAGNOSTIC_LOG = logPath

    writeDiagnosticLog('tts', 'request.started', { requestId: 'tts-1', chars: 10 })
    writeDiagnosticLog('tts', 'request.completed', { requestId: 'tts-1', wavBytes: 100 })

    const lines = fs.readFileSync(logPath, 'utf8').trim().split('\n')
    expect(lines).toHaveLength(2)
    expect(lines[0]).toContain('INFO [tts] request.started requestId="tts-1" chars=10')
    expect(lines[1]).toContain('INFO [tts] request.completed requestId="tts-1" wavBytes=100')
    expect(fs.statSync(logPath).mode & 0o777).toBe(0o600)
  })
})
