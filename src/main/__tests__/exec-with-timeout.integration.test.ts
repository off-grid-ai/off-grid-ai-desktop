import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const RUNNER = path.resolve(import.meta.dirname, '../../../scripts/exec-with-timeout.mjs')

describe('bounded native command runner', () => {
  it('returns the child exit code when it completes', () => {
    const result = spawnSync(process.execPath, [RUNNER, '1000', '/usr/bin/true'], {
      encoding: 'utf8'
    })
    expect(result.status, result.stderr).toBe(0)
  })

  it('terminates a native command that exceeds its deadline', () => {
    const result = spawnSync(process.execPath, [RUNNER, '50', '/bin/sleep', '5'], {
      encoding: 'utf8',
      timeout: 2_000,
      killSignal: 'SIGKILL'
    })
    expect(result.status).toBe(124)
    expect(result.stderr).toContain('/bin/sleep exceeded 50ms')
  })
})
