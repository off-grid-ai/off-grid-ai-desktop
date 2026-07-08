import { describe, it, expect } from 'vitest';
import { normalizeResidency, DEFAULT_RESIDENCY, MODALITIES } from '../runtime-residency';

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
});
