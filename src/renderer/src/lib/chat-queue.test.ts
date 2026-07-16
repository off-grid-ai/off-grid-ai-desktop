/**
 * Regression tests for per-conversation send/queue routing — the multi-tab bug
 * where a message queued in one tab ran/showed under another tab. Pure logic.
 */
import { describe, it, expect } from 'vitest'
import { shouldQueue, enqueue, dequeue, queuedCount } from './chat-queue'

describe('shouldQueue — only blocks on the SAME conversation', () => {
  it('queues when that conversation is already generating', () => {
    expect(shouldQueue('A', new Set(['A']))).toBe(true)
  })
  it('runs immediately when a DIFFERENT conversation is generating (no cross-tab block)', () => {
    expect(shouldQueue('B', new Set(['A']))).toBe(false)
  })
  it('a fresh (null) conversation always runs', () => {
    expect(shouldQueue(null, new Set(['A', 'B']))).toBe(false)
  })
})

describe('enqueue / dequeue — FIFO, isolated per conversation', () => {
  it('keeps each conversation queue separate', () => {
    let q: Record<string, string[]> = {}
    q = enqueue(q, 'A', 'a1')
    q = enqueue(q, 'B', 'b1')
    q = enqueue(q, 'A', 'a2')
    expect(q.A).toEqual(['a1', 'a2'])
    expect(q.B).toEqual(['b1'])
  })

  it('dequeues FIFO from the right conversation only', () => {
    const q = { A: ['a1', 'a2'], B: ['b1'] }
    const first = dequeue(q, 'A')
    expect(first.item).toBe('a1')
    expect(first.next.A).toEqual(['a2'])
    expect(first.next.B).toEqual(['b1']) // untouched
  })

  it('dequeue on an empty conversation returns undefined and is a no-op', () => {
    const q = { A: [] as string[] }
    const r = dequeue(q, 'A')
    expect(r.item).toBeUndefined()
    expect(r.next).toBe(q)
  })
})

describe('queuedCount — chip shows the active tab only', () => {
  it('counts the given conversation; null → 0', () => {
    const q = { A: ['x', 'y'], B: ['z'] }
    expect(queuedCount(q, 'A')).toBe(2)
    expect(queuedCount(q, 'B')).toBe(1)
    expect(queuedCount(q, null)).toBe(0)
    expect(queuedCount(q, 'C')).toBe(0)
  })
})
