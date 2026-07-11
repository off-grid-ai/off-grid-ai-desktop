/**
 * Tests for the inference-settings math extracted from llm.ts: the mode presets,
 * the user-set sampling payload (undefined = omit), and the launch-vs-live change
 * decision that governs whether setSettings respawns the server. One case per branch.
 */

import { describe, it, expect } from 'vitest';
import { MODE_PRESETS, samplingPayload, launchArgsChanged, type LaunchState } from '../settings-math';

describe('MODE_PRESETS', () => {
  it('conservative quantizes the KV cache (q8_0) with flash-attn and a modest ctx', () => {
    expect(MODE_PRESETS.conservative).toEqual({ ctxSize: 8192, kvCacheType: 'q8_0', flashAttn: true });
  });
  it('balanced preserves prior behavior (16k f16, no flash-attn)', () => {
    expect(MODE_PRESETS.balanced).toEqual({ ctxSize: 16384, kvCacheType: 'f16', flashAttn: false });
  });
  it('extreme pushes context to 64k', () => {
    expect(MODE_PRESETS.extreme).toEqual({ ctxSize: 65536, kvCacheType: 'f16', flashAttn: false });
  });
});

describe('samplingPayload', () => {
  it('omits every param the user has not set (all undefined -> empty)', () => {
    expect(samplingPayload({ topP: undefined, topK: undefined, minP: undefined, repeatPenalty: undefined })).toEqual({});
  });

  it('includes only the set params, mapped to llama.cpp keys', () => {
    expect(samplingPayload({ topP: 0.9, topK: undefined, minP: 0.05, repeatPenalty: undefined }))
      .toEqual({ top_p: 0.9, min_p: 0.05 });
  });

  it('maps all four when all set', () => {
    expect(samplingPayload({ topP: 0.8, topK: 40, minP: 0.02, repeatPenalty: 1.1 }))
      .toEqual({ top_p: 0.8, top_k: 40, min_p: 0.02, repeat_penalty: 1.1 });
  });

  it('includes a zero value (0 is a set number, not "unset")', () => {
    expect(samplingPayload({ topP: 0, topK: undefined, minP: undefined, repeatPenalty: undefined }))
      .toEqual({ top_p: 0 });
  });
});

const CURRENT: LaunchState = {
  ctxSize: 16384, kvCacheType: 'f16', flashAttn: false, gpuLayers: 99, threads: undefined, batchSize: undefined,
};

describe('launchArgsChanged', () => {
  it('true when a mode change forces it, even with an empty patch', () => {
    expect(launchArgsChanged({}, CURRENT, true)).toBe(true);
  });

  it('false for an empty patch and no mode change', () => {
    expect(launchArgsChanged({}, CURRENT, false)).toBe(false);
  });

  it('false when a launch field is present but equals the current value', () => {
    expect(launchArgsChanged({ ctxSize: 16384, gpuLayers: 99 }, CURRENT, false)).toBe(false);
  });

  it('true when ctxSize differs', () => {
    expect(launchArgsChanged({ ctxSize: 32768 }, CURRENT, false)).toBe(true);
  });

  it('true when kvCacheType differs', () => {
    expect(launchArgsChanged({ kvCacheType: 'q8_0' }, CURRENT, false)).toBe(true);
  });

  it('true when flashAttn differs', () => {
    expect(launchArgsChanged({ flashAttn: true }, CURRENT, false)).toBe(true);
  });

  it('true when gpuLayers differs', () => {
    expect(launchArgsChanged({ gpuLayers: 0 }, CURRENT, false)).toBe(true);
  });

  it('true when threads is newly set (current undefined)', () => {
    expect(launchArgsChanged({ threads: 8 }, CURRENT, false)).toBe(true);
  });

  it('true when batchSize is newly set (current undefined)', () => {
    expect(launchArgsChanged({ batchSize: 512 }, CURRENT, false)).toBe(true);
  });

  it('ignores non-launch fields (temperature etc are not in the patch shape here)', () => {
    // Only launch fields are inspected - a patch with just a matching ctxSize is no-change.
    expect(launchArgsChanged({ ctxSize: CURRENT.ctxSize }, CURRENT, false)).toBe(false);
  });
});
