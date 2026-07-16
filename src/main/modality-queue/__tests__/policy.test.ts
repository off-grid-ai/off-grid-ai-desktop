import { describe, it, expect } from 'vitest'
import { byPriority, canRun, selectNext, DEFAULT_POLICY, type QueueJob, type Tier } from '../policy'

let seq = 0
function job(tier: Tier, label = `j${tier}`): QueueJob {
  return { id: `id-${String(++seq)}`, tier, label, seq: seq }
}

describe('canRun', () => {
  it('lets a tier-2 job run when nothing heavy is running', () => {
    expect(canRun(job(2), [], DEFAULT_POLICY)).toBe(true)
  })

  it('blocks a tier-2 job while another tier-2 runs (one heavy at a time)', () => {
    const running = [job(2)]
    expect(canRun(job(2), running, DEFAULT_POLICY)).toBe(false)
  })

  it('tier-3 only runs when nothing at all is running', () => {
    expect(canRun(job(3), [], DEFAULT_POLICY)).toBe(true)
    expect(canRun(job(3), [job(1)], DEFAULT_POLICY)).toBe(false)
    expect(canRun(job(3), [job(2)], DEFAULT_POLICY)).toBe(false)
  })

  it('tier-1 coexists with a running tier-2 when the flag is on', () => {
    expect(canRun(job(1), [job(2)], { tier1CoexistsWithTier2: true })).toBe(true)
  })

  it('tier-1 waits behind a running tier-2 when the flag is off', () => {
    expect(canRun(job(1), [job(2)], { tier1CoexistsWithTier2: false })).toBe(false)
  })

  it('only one tier-1 runs at a time', () => {
    expect(canRun(job(1), [job(1)], DEFAULT_POLICY)).toBe(false)
  })
})

describe('byPriority', () => {
  it('orders by tier first, then FIFO by seq within a tier', () => {
    const a: QueueJob = { id: 'a', tier: 2, label: 'a', seq: 5 }
    const b: QueueJob = { id: 'b', tier: 1, label: 'b', seq: 9 }
    const c: QueueJob = { id: 'c', tier: 2, label: 'c', seq: 3 }
    const sorted = [a, b, c].sort(byPriority)
    expect(sorted.map((j) => j.id)).toEqual(['b', 'c', 'a'])
  })
})

describe('selectNext', () => {
  it('returns null when nothing is admissible (heavy running, only heavy waiting)', () => {
    const running = [{ id: 'r', tier: 2 as Tier, label: 'r', seq: 1 }]
    const waiting = [{ id: 'w', tier: 2 as Tier, label: 'w', seq: 2 }]
    expect(selectNext(running, waiting, DEFAULT_POLICY)).toBeNull()
  })

  it('picks the highest-priority admissible waiter (FIFO within tier)', () => {
    const waiting = [
      { id: 'late2', tier: 2 as Tier, label: 'l', seq: 4 },
      { id: 'early2', tier: 2 as Tier, label: 'e', seq: 2 }
    ]
    expect(selectNext([], waiting, DEFAULT_POLICY)?.id).toBe('early2')
  })

  it('tier-3 yields while a tier-1 or tier-2 job is RUNNING', () => {
    const waiting = [{ id: 'bg', tier: 3 as Tier, label: 'bg', seq: 3 }]
    expect(
      selectNext([{ id: 'r', tier: 2, label: 'r', seq: 1 }], waiting, DEFAULT_POLICY)
    ).toBeNull()
    expect(
      selectNext([{ id: 'r', tier: 1, label: 'r', seq: 1 }], waiting, DEFAULT_POLICY)
    ).toBeNull()
  })

  it('tier-3 yields while a tier-1/2 job is merely WAITING (foreground pending)', () => {
    const waiting = [
      { id: 'bg', tier: 3 as Tier, label: 'bg', seq: 1 },
      { id: 'fg', tier: 2 as Tier, label: 'fg', seq: 2 }
    ]
    // Nothing running, but fg (tier-2) is waiting → bg must not be chosen; fg is.
    expect(selectNext([], waiting, DEFAULT_POLICY)?.id).toBe('fg')
  })

  it('tier-3 runs when nothing in tier 1/2 runs or waits', () => {
    const waiting = [{ id: 'bg', tier: 3 as Tier, label: 'bg', seq: 1 }]
    expect(selectNext([], waiting, DEFAULT_POLICY)?.id).toBe('bg')
  })

  it('tier-1 alongside running tier-2 depends on the coexist flag', () => {
    const running = [{ id: 'img', tier: 2 as Tier, label: 'img', seq: 1 }]
    const waiting = [{ id: 'dict', tier: 1 as Tier, label: 'dict', seq: 2 }]
    expect(selectNext(running, waiting, { tier1CoexistsWithTier2: true })?.id).toBe('dict')
    expect(selectNext(running, waiting, { tier1CoexistsWithTier2: false })).toBeNull()
  })
})
