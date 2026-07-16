import { describe, it, expect } from 'vitest'
import { ModalityQueue } from '../modality-queue/queue'
import { registerRuntime, type ManagedRuntime } from '../runtime-manager'
import { normalizeResidency, type Modality, type ResidencyMode } from '../runtime-residency'

// Integration test: the REAL ModalityQueue + REAL registerRuntime seam driving REAL
// engine objects. No mocks of our own logic — each "engine" is a tiny in-memory
// stand-in that actually tracks whether its model is loaded, so an assertion on
// `loaded` reflects the true effect of evict/warm/release flowing through the queue.

/** A minimal engine that holds real loaded-state, exposed as a ManagedRuntime. */
class FakeEngine implements ManagedRuntime {
  loaded = true // starts resident (registered engines begin loaded)
  readonly modality: Modality
  constructor(modality: Modality) {
    this.modality = modality
  }
  evict(): void {
    this.loaded = false
  } // free memory
  warm(): void {
    this.loaded = true
  } // resident re-warm: reload now
  release(): void {
    /* on-demand: stay down, lazy-load on next use */
  }
}

/** Residency map backed by a plain object, mutated like the real persisted store. */
function store(initial: Partial<Record<Modality, ResidencyMode>>) {
  const map = normalizeResidency(initial)
  return {
    read: (m: Modality) => map[m],
    set: (m: Modality, mode: ResidencyMode) => {
      map[m] = mode
    }
  }
}

describe('residency integration (real queue + real seam + real engines)', () => {
  it('resident LLM: an image job evicts it, and it is truly reloaded afterwards', async () => {
    const q = new ModalityQueue()
    const s = store({ llm: 'resident' })
    const llm = new FakeEngine('llm')
    registerRuntime(llm, { queue: q, readMode: s.read })

    expect(llm.loaded).toBe(true)
    let duringJob: boolean | null = null
    await q.run({ tier: 2, label: 'image', evicts: ['llm'] }, async () => {
      duringJob = llm.loaded // LLM must be evicted while the image job runs
    })

    expect(duringJob).toBe(false) // evicted before/for the job
    expect(llm.loaded).toBe(true) // resident -> reloaded after the job
  })

  it('on-demand engine: evicted for the job and left DOWN afterwards (RAM stays free)', async () => {
    // Use an UNLOCKED modality (tts) — the llm is locked resident (screen replay),
    // so it can never be on-demand; that lock is asserted in runtime-residency.test.
    const q = new ModalityQueue()
    const s = store({ tts: 'on-demand' })
    const tts = new FakeEngine('tts')
    registerRuntime(tts, { queue: q, readMode: s.read })

    await q.run({ tier: 2, label: 'image', evicts: ['tts'] }, async () => {})
    expect(tts.loaded).toBe(false) // on-demand -> stays down (release, no reload)
  })

  it('flipping the mode at runtime changes the re-warm without re-registering', async () => {
    const q = new ModalityQueue()
    const s = store({ llm: 'resident' })
    const llm = new FakeEngine('llm')
    registerRuntime(llm, { queue: q, readMode: s.read })

    await q.run({ tier: 2, label: 'image', evicts: ['llm'] }, async () => {})
    expect(llm.loaded).toBe(true) // resident reloaded

    s.set('llm', 'on-demand') // user toggles to on-demand in Settings
    await q.run({ tier: 2, label: 'image', evicts: ['llm'] }, async () => {})
    expect(llm.loaded).toBe(false) // now left down
  })

  it('an engine that lazily reloaded is STILL evicted next round (no double-resident)', async () => {
    // The correctness guarantee: the queue always evicts a declared id, so an
    // on-demand engine that reloaded itself between jobs cannot stay resident
    // alongside the next heavy model (the beachball this whole system prevents).
    const q = new ModalityQueue()
    const s = store({ tts: 'on-demand' })
    const tts = new FakeEngine('tts')
    registerRuntime(tts, { queue: q, readMode: s.read })

    await q.run({ tier: 2, label: 'image', evicts: ['tts'] }, async () => {})
    expect(tts.loaded).toBe(false)
    tts.loaded = true // simulate the engine lazily reloading itself between jobs

    let duringJob: boolean | null = null
    await q.run({ tier: 2, label: 'image', evicts: ['tts'] }, async () => {
      duringJob = tts.loaded
    })
    expect(duringJob).toBe(false) // evicted again despite having reloaded
  })

  it('two heavy engines never run at once; the queued one waits', async () => {
    const q = new ModalityQueue()
    const order: string[] = []
    let release!: () => void
    const gate = new Promise<void>((r) => {
      release = r
    })

    const first = q.run({ tier: 2, label: 'image-a' }, async () => {
      order.push('a-start')
      await gate
      order.push('a-end')
    })
    const second = q.run({ tier: 2, label: 'image-b' }, async () => {
      order.push('b-start')
    })

    await new Promise((r) => setTimeout(r, 0))
    expect(order).toEqual(['a-start']) // b is waiting, not running
    release()
    await Promise.all([first, second])
    expect(order).toEqual(['a-start', 'a-end', 'b-start']) // strictly sequential
  })
})
