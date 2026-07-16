/**
 * The two standard heavy-job descriptors. Previously spelled out inline at every
 * call site (chat 4× in ipc.ts); asserted here so their shape — the mutual
 * eviction contract that keeps chat and image off unified memory at once — is
 * defined and checked once.
 */
import { describe, it, expect } from 'vitest'
import { CHAT_JOB, IMAGE_JOB } from '../queue'

describe('standard modality jobs', () => {
  it('CHAT_JOB evicts a resident image server (tier 2)', () => {
    expect(CHAT_JOB).toEqual({ tier: 2, label: 'chat', evicts: ['image'] })
  })

  it('IMAGE_JOB evicts the resident LLM (tier 2)', () => {
    expect(IMAGE_JOB).toEqual({ tier: 2, label: 'image', evicts: ['llm'] })
  })

  it('they evict each other (mutually exclusive on unified memory)', () => {
    expect(CHAT_JOB.evicts).toContain('image')
    expect(IMAGE_JOB.evicts).toContain('llm')
  })

  it('are frozen so a caller cannot mutate the shared descriptor', () => {
    expect(Object.isFrozen(CHAT_JOB)).toBe(true)
    expect(Object.isFrozen(IMAGE_JOB)).toBe(true)
  })
})
