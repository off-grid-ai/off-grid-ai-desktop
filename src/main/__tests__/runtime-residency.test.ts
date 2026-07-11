import { describe, it, expect } from 'vitest';
import { normalizeResidency, DEFAULT_RESIDENCY, MODALITIES, isResidencyLocked } from '../runtime-residency';

describe('normalizeResidency', () => {
  it('returns the defaults for empty/garbage input', () => {
    expect(normalizeResidency({})).toEqual(DEFAULT_RESIDENCY);
    expect(normalizeResidency(null)).toEqual(DEFAULT_RESIDENCY);
    expect(normalizeResidency('nope')).toEqual(DEFAULT_RESIDENCY);
  });

  it('defaults match today: llm resident, everything else on-demand', () => {
    expect(DEFAULT_RESIDENCY).toEqual({ llm: 'resident', image: 'on-demand', stt: 'on-demand', tts: 'on-demand' });
  });

  it('applies valid per-modality overrides and keeps the rest at default', () => {
    expect(normalizeResidency({ image: 'resident', stt: 'resident' })).toEqual({
      llm: 'resident', image: 'resident', stt: 'resident', tts: 'on-demand',
    });
  });

  it('drops invalid values and unknown modalities', () => {
    const r = normalizeResidency({ llm: 'sometimes', tts: 'resident', bogus: 'resident' });
    expect(r.llm).toBe('resident'); // invalid -> default
    expect(r.tts).toBe('resident'); // valid override kept
    expect(Object.keys(r).sort()).toEqual([...MODALITIES].sort());
  });

  it('forces locked modalities (chat model) resident even if persisted on-demand', () => {
    // A stale/hand-edited on-demand for the LLM must never take effect — screen
    // replay distills through it continuously, so on-demand would thrash-reload it.
    const r = normalizeResidency({ llm: 'on-demand', image: 'on-demand' });
    expect(r.llm).toBe('resident');   // locked -> coerced back
    expect(r.image).toBe('on-demand'); // unlocked -> honored
  });
});

describe('isResidencyLocked', () => {
  it('locks the chat model and leaves the rest user-controlled', () => {
    expect(isResidencyLocked('llm')).toBe(true);
    expect(isResidencyLocked('image')).toBe(false);
    expect(isResidencyLocked('stt')).toBe(false);
    expect(isResidencyLocked('tts')).toBe(false);
  });
});
