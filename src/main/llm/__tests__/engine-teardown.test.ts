// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { spawn, type ChildProcess } from 'node:child_process'
import { terminateEngine, type TeardownEffects } from '../engine-teardown'

// A recording fake: `aliveAtStart` drives the initial check, and each waitForExit consumes the next
// scripted "did it exit?" answer, so we assert the exact signal escalation without a real process.
function build(opts: { aliveAtStart: boolean; exitAfter: ('yes' | 'no')[] }): {
  fx: TeardownEffects
  signals: string[]
} {
  const signals: string[] = []
  const exits = [...opts.exitAfter]
  return {
    signals,
    fx: {
      isAlive: () => opts.aliveAtStart,
      sendSignal: (sig) => signals.push(sig),
      waitForExit: async () => (exits.shift() ?? 'no') === 'yes'
    }
  }
}

describe('terminateEngine — SIGTERM → SIGKILL escalation (fakes)', () => {
  it('does nothing when the process is already dead', async () => {
    const { fx, signals } = build({ aliveAtStart: false, exitAfter: [] })
    expect(await terminateEngine(fx, 10)).toBe('already-dead')
    expect(signals).toEqual([])
  })

  it('exits gracefully on SIGTERM (no SIGKILL sent)', async () => {
    const { fx, signals } = build({ aliveAtStart: true, exitAfter: ['yes'] })
    expect(await terminateEngine(fx, 10)).toBe('graceful')
    expect(signals).toEqual(['SIGTERM'])
  })

  it('escalates to SIGKILL when SIGTERM is ignored', async () => {
    const { fx, signals } = build({ aliveAtStart: true, exitAfter: ['no', 'yes'] })
    expect(await terminateEngine(fx, 10)).toBe('forced')
    expect(signals).toEqual(['SIGTERM', 'SIGKILL'])
  })

  it('reports "stuck" when even SIGKILL does not reap it in the window', async () => {
    const { fx, signals } = build({ aliveAtStart: true, exitAfter: ['no', 'no'] })
    expect(await terminateEngine(fx, 10)).toBe('stuck')
    expect(signals).toEqual(['SIGTERM', 'SIGKILL'])
  })

  it('does NOT SIGKILL when the process exits during the grace wait (recheck wins)', async () => {
    // waitForExit races and returns false, but the process actually died — isAlive is false on the
    // recheck, so no SIGKILL is sent and it is reported graceful, not forced.
    const signals: string[] = []
    let alive = true
    const fx = {
      isAlive: () => alive,
      sendSignal: (s: 'SIGTERM' | 'SIGKILL') => signals.push(s),
      waitForExit: async () => {
        alive = false // it exited right as the wait timed out
        return false
      }
    }
    expect(await terminateEngine(fx, 10)).toBe('graceful')
    expect(signals).toEqual(['SIGTERM']) // no SIGKILL
  })
})

// Real-process integration: prove the escalation actually reaps an OS process — including one that
// TRAPS SIGTERM (the "won't die on a polite ask" case that motivated this task).
function realEffects(proc: ChildProcess): TeardownEffects {
  const pid = proc.pid as number
  return {
    isAlive: () => proc.exitCode === null && proc.signalCode === null,
    sendSignal: (sig) => {
      try {
        process.kill(pid, sig)
      } catch {
        /* already gone */
      }
    },
    waitForExit: (ms) =>
      new Promise((resolve) => {
        if (proc.exitCode !== null || proc.signalCode !== null) {
          resolve(true)
          return
        }
        const onExit = (): void => {
          clearTimeout(timer)
          resolve(true)
        }
        const timer = setTimeout(() => {
          proc.off('exit', onExit)
          resolve(false)
        }, ms)
        proc.once('exit', onExit)
      })
  }
}

describe('terminateEngine — real OS process', () => {
  it('reaps a process that exits cleanly on SIGTERM (graceful)', async () => {
    const proc = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'])
    await new Promise((r) => proc.once('spawn', r))
    expect(await terminateEngine(realEffects(proc), 2000)).toBe('graceful')
    expect(proc.signalCode).toBe('SIGTERM')
  })

  it('force-kills a process that TRAPS SIGTERM (forced)', async () => {
    const proc = spawn(process.execPath, [
      '-e',
      "process.on('SIGTERM', () => {}); console.log('ready'); setInterval(() => {}, 1000)"
    ])
    // Wait until the child has actually installed the SIGTERM trap (avoid signalling during startup,
    // before the handler exists — that would let the default terminate win and look "graceful").
    await new Promise((r) => proc.stdout!.once('data', r))
    expect(await terminateEngine(realEffects(proc), 400)).toBe('forced')
    expect(proc.signalCode).toBe('SIGKILL')
  })
})
