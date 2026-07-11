// Pure inference-settings math, extracted from llm.ts so the mode presets, the
// user-set sampling payload, and the launch-vs-live change decision are a single
// source of truth and unit-testable without Electron/fs. No side effects, no imports
// beyond the shared model-sizing types (which are themselves pure).

import type { KvCacheType, PerformanceMode } from '../model-sizing';

// Friendly presets that decide how much of the machine the local model uses.
// Conservative leaves lots of headroom (safest on small / busy machines); Extreme
// pushes context/memory for max capability. The RAM clamp still applies on top, so
// even Extreme can't overcommit into a freeze. Context is a CEILING, not a
// fill-the-RAM target: a big context means a big KV cache (the bulk of the server's
// memory), so defaults stay modest. Conservative also quantizes the KV cache (q8_0)
// to roughly halve it.
export const MODE_PRESETS: Record<PerformanceMode, { ctxSize: number; kvCacheType: KvCacheType; flashAttn: boolean }> = {
  conservative: { ctxSize: 8192, kvCacheType: 'q8_0', flashAttn: true },
  balanced: { ctxSize: 16384, kvCacheType: 'f16', flashAttn: false },
  extreme: { ctxSize: 65536, kvCacheType: 'f16', flashAttn: false },
};

/** The tunable inference state that the sampling/launch math reads. Matches the
 *  private fields on LLMService so it can pass `this` straight in. */
export interface SamplingState {
  topP: number | undefined;
  topK: number | undefined;
  minP: number | undefined;
  repeatPenalty: number | undefined;
}

/** Sampling params to merge into a request payload - ONLY those the user actually
 *  set (undefined = let llama.cpp use its default). */
export function samplingPayload(s: SamplingState): Record<string, number> {
  const p: Record<string, number> = {};
  if (typeof s.topP === 'number') p.top_p = s.topP;
  if (typeof s.topK === 'number') p.top_k = s.topK;
  if (typeof s.minP === 'number') p.min_p = s.minP;
  if (typeof s.repeatPenalty === 'number') p.repeat_penalty = s.repeatPenalty;
  return p;
}

/** The launch-time settings a patch is compared against to decide whether a respawn
 *  is needed. */
export interface LaunchState {
  ctxSize: number;
  kvCacheType: KvCacheType;
  flashAttn: boolean;
  gpuLayers: number;
  threads: number | undefined;
  batchSize: number | undefined;
}

/** Whether a settings patch changes any LAUNCH-TIME arg (context, KV-cache type,
 *  flash-attn, GPU layers, threads, batch) and therefore needs a server respawn.
 *  `modeChanged` forces true (a mode switch always rewrites launch args). A field
 *  only counts when present in the patch AND different from current. */
export function launchArgsChanged(
  patch: {
    ctxSize?: number;
    kvCacheType?: KvCacheType;
    flashAttn?: boolean;
    gpuLayers?: number;
    threads?: number;
    batchSize?: number;
  },
  current: LaunchState,
  modeChanged: boolean,
): boolean {
  return modeChanged ||
    (typeof patch.ctxSize === 'number' && patch.ctxSize !== current.ctxSize) ||
    (patch.kvCacheType !== undefined && patch.kvCacheType !== current.kvCacheType) ||
    (typeof patch.flashAttn === 'boolean' && patch.flashAttn !== current.flashAttn) ||
    (typeof patch.gpuLayers === 'number' && patch.gpuLayers !== current.gpuLayers) ||
    (typeof patch.threads === 'number' && patch.threads !== current.threads) ||
    (typeof patch.batchSize === 'number' && patch.batchSize !== current.batchSize);
}
