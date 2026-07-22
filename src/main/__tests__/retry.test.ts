/**
 * Unit tests for retryWithDeadline - the pure retry-with-deadline loop shared by
 * the model-server gateway proxies (proxyToLlama / callLlamaJson).
 *
 * Every case uses an injected fake Clock (no real sleeps): `now()` returns a
 * controllable value and `setTimeout` queues the retry so the test can advance
 * time deterministically. One case per branch: first-try success, retry-then-
 * success, deadline exhaustion, the transient-vs-fatal distinction, the
 * not-replayable fast-fail, and that the deadline is never overshot.
 */
import { describe, it, expect, vi } from 'vitest'
import { retryWithDeadline, systemClock, type Clock } from '../lib/retry'

/**
 * A controllable clock: `t` is the current time, and scheduled callbacks are
 * held in a queue. `advance(ms)` moves time forward and fires every callback
 * whose delay has elapsed - mirroring how real timers would fire, without any
 * actual waiting.
 */
function fakeClock(start = 0): Clock & { advance: (ms: number) => void; pending: number } {
  let t = start
  const queue: Array<{ at: number; cb: () => void }> = []
  return {
    now: () => t,
    setTimeout: (cb, ms) => {
      queue.push({ at: t + ms, cb })
    },
    advance(ms: number) {
      t += ms
      // Fire everything due at or before the new time, in scheduled order.
      const due = queue.filter((e) => e.at <= t)
      for (const e of due) queue.splice(queue.indexOf(e), 1)
      for (const e of due) e.cb()
    },
    get pending() {
      return queue.length
    }
  }
}

describe('retryWithDeadline', () => {
  it('resolves on the first attempt without scheduling any retry', async () => {
    const clock = fakeClock(0)
    const fn = vi.fn().mockResolvedValue('ok')

    const result = await retryWithDeadline(fn, { deadlineMs: 10_000, clock })

    expect(result).toBe('ok')
    expect(fn).toHaveBeenCalledTimes(1)
    expect(clock.pending).toBe(0)
  })

  it('retries a transient failure then resolves', async () => {
    const clock = fakeClock(0)
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockResolvedValueOnce('recovered')

    const promise = retryWithDeadline(fn, { deadlineMs: 10_000, delayMs: 1000, clock })
    // First attempt has run and rejected; the retry is scheduled, not yet fired.
    await Promise.resolve()
    expect(fn).toHaveBeenCalledTimes(1)
    expect(clock.pending).toBe(1)

    clock.advance(1000) // fire the scheduled retry
    await expect(promise).resolves.toBe('recovered')
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('retries repeatedly across the window then succeeds', async () => {
    const clock = fakeClock(0)
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('down'))
      .mockRejectedValueOnce(new Error('down'))
      .mockResolvedValueOnce('up')

    const promise = retryWithDeadline(fn, { deadlineMs: 10_000, delayMs: 1000, clock })
    await Promise.resolve()
    clock.advance(1000) // retry 1
    await Promise.resolve()
    clock.advance(1000) // retry 2 -> success

    await expect(promise).resolves.toBe('up')
    expect(fn).toHaveBeenCalledTimes(3)
  })

  it('throws the last failure once the deadline has passed', async () => {
    const clock = fakeClock(0)
    const boom = new Error('still down')
    const fn = vi.fn().mockRejectedValue(boom)

    // deadlineMs = 2000, delay = 1000: attempt@0 (now<2000, retry), retry@1000
    // (now<2000, retry), retry@2000 (now===2000, NOT < deadline -> give up).
    const promise = retryWithDeadline(fn, { deadlineMs: 2000, delayMs: 1000, clock })
    const settled = promise.catch((e) => e)

    await Promise.resolve()
    clock.advance(1000)
    await Promise.resolve()
    clock.advance(1000)

    await expect(settled).resolves.toBe(boom)
    expect(fn).toHaveBeenCalledTimes(3)
  })

  it('does not retry a fatal failure even within the deadline', async () => {
    const clock = fakeClock(0)
    const fatal = Object.assign(new Error('HTTP 400'), { fatal: true })
    const fn = vi.fn().mockRejectedValue(fatal)

    const err = await retryWithDeadline(fn, {
      deadlineMs: 10_000,
      delayMs: 1000,
      clock,
      isTransient: (e) => !(e as { fatal?: boolean })?.fatal
    }).catch((e) => e)

    expect(err).toBe(fatal)
    expect(fn).toHaveBeenCalledTimes(1)
    expect(clock.pending).toBe(0)
  })

  it('still retries a transient failure under the same classifier', async () => {
    const clock = fakeClock(0)
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('connection reset')) // no fatal flag -> transient
      .mockResolvedValueOnce('ok')

    const promise = retryWithDeadline(fn, {
      deadlineMs: 10_000,
      delayMs: 1000,
      clock,
      isTransient: (e) => !(e as { fatal?: boolean })?.fatal
    })
    await Promise.resolve()
    clock.advance(1000)

    await expect(promise).resolves.toBe('ok')
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('fails fast for a non-replayable request without scheduling a retry', async () => {
    const clock = fakeClock(0)
    const boom = new Error('stream already consumed')
    const fn = vi.fn().mockRejectedValue(boom)

    const err = await retryWithDeadline(fn, {
      deadlineMs: 10_000,
      replayable: false,
      clock
    }).catch((e) => e)

    expect(err).toBe(boom)
    expect(fn).toHaveBeenCalledTimes(1)
    expect(clock.pending).toBe(0)
  })

  it('a deadline at the first attempt yields no retries (fail fast)', async () => {
    const clock = fakeClock(1000)
    const boom = new Error('down')
    const fn = vi.fn().mockRejectedValue(boom)

    // now() === deadlineMs on the first failure -> not < deadline -> no retry.
    const err = await retryWithDeadline(fn, { deadlineMs: 1000, clock }).catch((e) => e)

    expect(err).toBe(boom)
    expect(fn).toHaveBeenCalledTimes(1)
    expect(clock.pending).toBe(0)
  })

  it('never runs an attempt past the deadline', async () => {
    // The last retry is scheduled while now < deadline; when it fires, now has
    // advanced past the deadline, so no FURTHER attempt is scheduled. Assert the
    // attempt count matches exactly the attempts that could start before/at each
    // check, and that no callback outlives the deadline.
    const clock = fakeClock(0)
    const fn = vi.fn().mockRejectedValue(new Error('down'))

    const promise = retryWithDeadline(fn, { deadlineMs: 3000, delayMs: 1000, clock })
    const settled = promise.catch(() => 'gave-up')

    // attempt@0 (now 0 < 3000 -> schedule)
    await Promise.resolve()
    expect(fn).toHaveBeenCalledTimes(1)
    clock.advance(1000) // retry@1000 (1000 < 3000 -> schedule)
    await Promise.resolve()
    expect(fn).toHaveBeenCalledTimes(2)
    clock.advance(1000) // retry@2000 (2000 < 3000 -> schedule)
    await Promise.resolve()
    expect(fn).toHaveBeenCalledTimes(3)
    clock.advance(1000) // retry@3000 (3000 NOT < 3000 -> give up, no schedule)
    await Promise.resolve()
    expect(fn).toHaveBeenCalledTimes(4)
    expect(clock.pending).toBe(0)

    await expect(settled).resolves.toBe('gave-up')
  })

  it('systemClock is backed by real timers', () => {
    // Guard the default seam: now() tracks Date.now and setTimeout schedules.
    const before = Date.now()
    expect(systemClock.now()).toBeGreaterThanOrEqual(before)
    const spy = vi.spyOn(global, 'setTimeout')
    systemClock.setTimeout(() => {}, 0)
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })
})
