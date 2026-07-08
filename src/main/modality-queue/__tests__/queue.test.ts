import { describe, it, expect, vi } from 'vitest';
import { ModalityQueue, type QueueState } from '../queue';

/** A controllable async fn: resolves only when release() is called. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('ModalityQueue', () => {
  it('runs two tier-2 jobs sequentially, not concurrently', async () => {
    const q = new ModalityQueue();
    const events: string[] = [];
    const d1 = deferred<void>();
    const d2 = deferred<void>();

    const p1 = q.run({ tier: 2, label: 'a' }, async () => { events.push('a-start'); await d1.promise; events.push('a-end'); });
    const p2 = q.run({ tier: 2, label: 'b' }, async () => { events.push('b-start'); await d2.promise; events.push('b-end'); });

    await tick();
    // Only the first tier-2 has started; the second is still waiting.
    expect(events).toEqual(['a-start']);
    expect(q.getState().running.map((r) => r.label)).toEqual(['a']);
    expect(q.getState().queued.map((r) => r.label)).toEqual(['b']);

    d1.resolve();
    await p1;
    await tick();
    // Now b has been admitted.
    expect(events).toEqual(['a-start', 'a-end', 'b-start']);

    d2.resolve();
    await p2;
    expect(events).toEqual(['a-start', 'a-end', 'b-start', 'b-end']);
  });

  it('evicts a declared engine BEFORE the job, then re-warms it AFTER', async () => {
    const q = new ModalityQueue();
    const order: string[] = [];
    const evict = vi.fn(async () => { order.push('evict'); });
    const warm = vi.fn(async () => { order.push('warm'); });
    q.registerEvictable('llm', { evict, warm });

    await q.run({ tier: 2, label: 'image', evicts: ['llm'] }, async () => { order.push('job'); });

    expect(evict).toHaveBeenCalledTimes(1);
    expect(warm).toHaveBeenCalledTimes(1);
    // evict before the job, warm after it (mode-aware behavior lives in the hook).
    expect(order).toEqual(['evict', 'job', 'warm']);
  });

  it('always calls evict for a declared id (idempotent even if the engine is down)', async () => {
    // The queue does NOT track exact residency — it always evicts, so an engine that
    // lazily reloaded can't slip through and leave two models resident.
    const q = new ModalityQueue();
    const evict = vi.fn();
    q.registerEvictable('llm', { evict });

    await q.run({ tier: 2, label: 'image', evicts: ['llm'] }, async () => {});
    expect(evict).toHaveBeenCalledTimes(1);
  });

  it('lets a tier-1 job run alongside a running tier-2 when coexist is on', async () => {
    const q = new ModalityQueue();
    q.setTier1CoexistsWithTier2(true);
    const events: string[] = [];
    const heavy = deferred<void>();

    const pImage = q.run({ tier: 2, label: 'image' }, async () => { events.push('image-start'); await heavy.promise; });
    await tick();
    expect(events).toEqual(['image-start']);

    // Dictation (tier-1) should be admitted even though image (tier-2) is running.
    const pDict = q.run({ tier: 1, label: 'dictation' }, async () => { events.push('dictation'); });
    await pDict;
    expect(events).toContain('dictation');

    heavy.resolve();
    await pImage;
  });

  it('holds a tier-1 job behind a running tier-2 when coexist is off', async () => {
    const q = new ModalityQueue();
    q.setTier1CoexistsWithTier2(false);
    const events: string[] = [];
    const heavy = deferred<void>();

    const pImage = q.run({ tier: 2, label: 'image' }, async () => { events.push('image-start'); await heavy.promise; });
    await tick();

    let dictDone = false;
    const pDict = q.run({ tier: 1, label: 'dictation' }, async () => { events.push('dictation'); }).then(() => { dictDone = true; });
    await tick();
    expect(dictDone).toBe(false); // still queued behind the running image job

    heavy.resolve();
    await pImage;
    await pDict;
    expect(events).toEqual(['image-start', 'dictation']);
  });

  it('emits onChange reflecting running + queued state', async () => {
    const q = new ModalityQueue();
    const snapshots: QueueState[] = [];
    q.onChange((s) => snapshots.push(s));
    const d = deferred<void>();

    const p1 = q.run({ tier: 2, label: 'a' }, async () => { await d.promise; });
    const p2 = q.run({ tier: 2, label: 'b' }, async () => {});
    await tick();

    // At some point we observed a=running while b=queued.
    const sawQueued = snapshots.some(
      (s) => s.running.some((r) => r.label === 'a') && s.queued.some((r) => r.label === 'b'),
    );
    expect(sawQueued).toBe(true);

    d.resolve();
    await p1; await p2;
  });

  it('when disabled, runs fn immediately without serializing (concurrent)', async () => {
    const q = new ModalityQueue();
    q.setEnabled(false);
    const evict = vi.fn();
    q.registerEvictable('llm', { evict });

    const events: string[] = [];
    const d1 = deferred<void>();
    const p1 = q.run({ tier: 2, label: 'a', evicts: ['llm'] }, async () => { events.push('a'); await d1.promise; });
    const p2 = q.run({ tier: 2, label: 'b' }, async () => { events.push('b'); });
    await p2; // b finishes even though a is still pending → they ran concurrently
    expect(events).toEqual(['a', 'b']);
    expect(evict).not.toHaveBeenCalled(); // no eviction when disabled

    d1.resolve();
    await p1;
  });

  it('releases the slot even when a job throws', async () => {
    const q = new ModalityQueue();
    await expect(q.run({ tier: 2, label: 'boom' }, async () => { throw new Error('x'); })).rejects.toThrow('x');
    // Next job still admitted — slot was freed in finally.
    const ran = await q.run({ tier: 2, label: 'ok' }, async () => 42);
    expect(ran).toBe(42);
    expect(q.getState().running).toHaveLength(0);
  });
});
