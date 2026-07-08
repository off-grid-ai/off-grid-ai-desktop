// ModalityQueue — the memory-admission scheduler for heavy model work.
//
// On a 16GB unified-memory Mac two big models resident at once (chat + image, or
// chat + replay-vision) overflow RAM and swap the whole machine into a beachball.
// This queue serializes heavy jobs by PRIORITY (see policy.ts) and evicts named
// engines before a job runs, so only one heavy model is resident at a time. It
// generalizes the ad-hoc llm.pause()/resume() bracketing that imagegen.ts did
// inline: engines register themselves as evictable, jobs declare what they evict.
//
// SOLID: this file is the thin IO layer (async/await + eviction hooks + state);
// ALL ordering/admission decisions live in the pure policy.ts and are called from
// here. It never imports llm/image/capture — those register through the hooks.

import { DEFAULT_POLICY, selectNext, type PolicyConfig, type QueueJob, type Tier } from './policy';

/** An engine that can free its resident memory on demand (and warm back up). */
export interface Evictable {
  /** Free the engine's memory NOW. Awaited before a job that evicts it runs. */
  evict: () => Promise<void> | void;
  /** Optional: warm the engine back up. Not called by the queue itself — the
   *  engine's own lazy-init handles re-warming on next use; kept for callers that
   *  want an explicit warm hook. */
  warm?: () => Promise<void> | void;
}

/** A job to run through the queue. */
export interface QueueRequest {
  tier: Tier;
  label: string;
  /** Ids of registered evictables to free (if resident) before this job runs. */
  evicts?: string[];
}

/** Snapshot of what's running + waiting, for a "queued" indicator in the UI. */
export interface QueueState {
  running: { label: string; tier: Tier }[];
  queued: { label: string; tier: Tier }[];
}

interface Waiter {
  job: QueueJob;
  request: QueueRequest;
  admit: () => void;
}

export class ModalityQueue {
  private running = new Map<string, QueueJob>();
  private waiting: Waiter[] = [];
  private evictables = new Map<string, Evictable>();
  /** Which evictable ids are currently resident (so we only evict what's up). */
  private resident = new Set<string>();
  private seqCounter = 0;
  private idCounter = 0;
  private changeCbs = new Set<(s: QueueState) => void>();

  private cfg: PolicyConfig = { ...DEFAULT_POLICY };
  /** Master switch. When off, run() executes fn immediately (today's concurrent
   *  behavior) — no serialization, no eviction. */
  private enabled = true;

  /** Turn the queue on/off. Off = pre-queue concurrent behavior. */
  setEnabled(on: boolean): void {
    this.enabled = on;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  /** Whether a running tier-2 job lets a tier-1 (dictation) job run alongside it. */
  setTier1CoexistsWithTier2(coexists: boolean): void {
    this.cfg.tier1CoexistsWithTier2 = coexists;
  }

  /** Register (or replace) an evictable engine by id. Engines register themselves
   *  so the queue never imports them (layering). Marked resident up front — the
   *  first job that evicts it will free it if it's actually loaded; evict() is a
   *  no-op when the engine is already down. */
  registerEvictable(id: string, e: Evictable): void {
    this.evictables.set(id, e);
    this.resident.add(id);
  }

  /** Mark an engine resident/not so the queue only evicts what's actually loaded.
   *  Optional: an engine that self-evicts on idle can report its state here. */
  setResident(id: string, resident: boolean): void {
    if (!this.evictables.has(id)) return;
    if (resident) this.resident.add(id);
    else this.resident.delete(id);
  }

  onChange(cb: (s: QueueState) => void): () => void {
    this.changeCbs.add(cb);
    return () => this.changeCbs.delete(cb);
  }

  getState(): QueueState {
    return {
      running: [...this.running.values()].map((j) => ({ label: j.label, tier: j.tier })),
      queued: this.waiting.map((w) => ({ label: w.job.label, tier: w.job.tier })),
    };
  }

  private emitChange(): void {
    const s = this.getState();
    for (const cb of this.changeCbs) {
      try { cb(s); } catch { /* a listener must never break the scheduler */ }
    }
  }

  /**
   * Enqueue a job, wait until the policy admits it, evict what it declares, run
   * `fn`, release the slot, then admit the next waiter. Cooperative: a running
   * job is NEVER killed to make room — admission only gates jobs not yet started.
   */
  async run<T>(request: QueueRequest, fn: () => Promise<T>): Promise<T> {
    if (!this.enabled) return fn();

    const job: QueueJob = {
      id: `job-${String(++this.idCounter)}`,
      tier: request.tier,
      label: request.label,
      seq: ++this.seqCounter,
    };

    // Wait for admission (resolves synchronously if the slot is free right now).
    await new Promise<void>((resolve) => {
      this.waiting.push({ job, request, admit: resolve });
      this.emitChange();
      this.pump();
    });

    try {
      return await fn();
    } finally {
      this.running.delete(job.id);
      this.emitChange();
      this.pump();
    }
  }

  /** Move any admissible waiter into the running set (evicting first). Called
   *  whenever the running set changes. */
  private pump(): void {
    // Admit greedily: tier-1 can coexist with a running tier-2, so more than one
    // waiter may become admissible on a single change.
    for (;;) {
      const runningArr = [...this.running.values()];
      const waitingArr = this.waiting.map((w) => w.job);
      const next = selectNext(runningArr, waitingArr, this.cfg);
      if (!next) return;

      const idx = this.waiting.findIndex((w) => w.job.id === next.id);
      if (idx === -1) return; // shouldn't happen — selectNext picks from waiting
      const waiter = this.waiting[idx];
      this.waiting.splice(idx, 1);
      this.running.set(waiter.job.id, waiter.job);

      // Evict what this job declares, THEN admit. Eviction is async IO; we run it
      // in a microtask so pump() itself stays synchronous and the running-set
      // bookkeeping is consistent before any await.
      void this.admitAfterEvict(waiter);
    }
  }

  private async admitAfterEvict(waiter: Waiter): Promise<void> {
    const toEvict = (waiter.request.evicts ?? []).filter((id) => this.resident.has(id));
    for (const id of toEvict) {
      const e = this.evictables.get(id);
      if (!e) continue;
      try {
        await e.evict();
      } catch (err) {
        console.error(`[ModalityQueue] evict '${id}' failed:`, err);
      }
      this.resident.delete(id);
    }
    this.emitChange();
    waiter.admit();
  }
}

/** The one process-wide queue. Engines register into it; callers wrap heavy work. */
export const modalityQueue = new ModalityQueue();
