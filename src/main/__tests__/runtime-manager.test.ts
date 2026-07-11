import { describe, it, expect } from 'vitest';
import { warmActionForMode, registerRuntime, type ManagedRuntime } from '../runtime-manager';
import { ModalityQueue } from '../modality-queue/queue';
import type { Modality, ResidencyMode } from '../runtime-residency';

describe('warmActionForMode', () => {
  it("resident re-warms (reload), on-demand releases (stay down, lazy load)", () => {
    expect(warmActionForMode('resident')).toBe('warm');
    expect(warmActionForMode('on-demand')).toBe('release');
  });
});

// A real, minimal runtime that records the order of lifecycle calls. Not a mock of
// our logic — it's a stand-in engine; the REAL ModalityQueue drives it end to end.
function recordingRuntime(modality: Modality, log: string[]): ManagedRuntime {
  return {
    modality,
    evict: () => { log.push('evict'); },
    warm: () => { log.push('warm'); },
    release: () => { log.push('release'); },
  };
}

describe('registerRuntime (single mode-aware seam, real queue)', () => {
  it('resident: evict before the displacing job, warm (reload) after', async () => {
    const q = new ModalityQueue();
    const log: string[] = [];
    registerRuntime(recordingRuntime('llm', log), { queue: q, readMode: () => 'resident' });

    await q.run({ tier: 2, label: 'image', evicts: ['llm'] }, async () => { log.push('job'); });

    expect(log).toEqual(['evict', 'job', 'warm']);
  });

  it('on-demand: same evict/job order, but release (no reload) after', async () => {
    const q = new ModalityQueue();
    const log: string[] = [];
    registerRuntime(recordingRuntime('llm', log), { queue: q, readMode: () => 'on-demand' });

    await q.run({ tier: 2, label: 'image', evicts: ['llm'] }, async () => { log.push('job'); });

    expect(log).toEqual(['evict', 'job', 'release']);
  });

  it('every modality flows through the SAME seam — mode alone changes behavior', async () => {
    // The point of the abstraction: the wiring is identical per engine; only the
    // persisted mode differs. Same registration path, same queue, uniform result.
    const modes: Record<Modality, ResidencyMode> = { llm: 'resident', image: 'resident', stt: 'on-demand', tts: 'on-demand' };
    for (const modality of Object.keys(modes) as Modality[]) {
      const q = new ModalityQueue();
      const log: string[] = [];
      registerRuntime(recordingRuntime(modality, log), { queue: q, readMode: (m) => modes[m] });
      await q.run({ tier: 2, label: 'x', evicts: [modality] }, async () => { log.push('job'); });
      expect(log).toEqual(['evict', 'job', modes[modality] === 'resident' ? 'warm' : 'release']);
    }
  });
});
