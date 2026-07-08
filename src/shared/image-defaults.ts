// Per-model image generation defaults — the SINGLE source of truth, shared by
// BOTH the main process (sd-server + sd-cli runtimes in imagegen.ts) AND the
// renderer (MemoryChat image composer). Keep it here in @offgrid/models so the
// two layers can never drift (a duplicated copy in the renderer once defaulted
// turbo models to 4 steps -> rainbow artifacts, contradicting the main process).
//
// Pure (no IO / no electron / no node) so it's unit-testable and importable from
// the renderer.
//
// The defaults encode the quality/speed tradeoff measured on an M4:
// - Distilled few-step models (SDXL-Lightning, *-Turbo, DMD2, Hyper) render at
//   good quality with ~10 steps / cfg 2 ONLY IF the KARRAS sigma schedule is used.
//   The default `discrete` schedule undercooks few-step sigmas -> smeared output
//   (the single biggest quality bug). 4 steps is too few (rainbow artifacts).
//   At 512² this is ~30s warm; 1024² is crisper but ~90s (the "quality" tier).
// - Full (non-distilled) checkpoints need ~28 steps + real CFG for quality;
//   dropping their step count wrecks the image, and they're fine on `discrete`.

export interface StandardModelDefaults {
  /** Default square size (px). Distilled fast-path is 512; full XL stays 1024. */
  defaultSize: number;
  /** Denoising steps. Full checkpoints need many; distilled models are few-step. */
  defaultSteps: number;
  /** Classifier-free guidance scale. */
  defaultCfg: number;
  /** Sampling method. */
  sampler: string;
  /** Denoiser sigma schedule. KARRAS is essential for crisp few-step output;
   *  full models use the engine default (discrete). */
  scheduler: string;
  /** Whether this is a distilled few-step model (Lightning/Turbo/DMD2). */
  fewStep: boolean;
  /** Whether this is an SDXL-family model (larger native resolution). */
  isXL: boolean;
}

/** Resolve the generation defaults for a checkpoint from its filename. */
export function standardModelDefaults(baseName: string): StandardModelDefaults {
  const base = baseName;
  const isLightning = /lightning/i.test(base);
  const isTurbo = /turbo|dmd2?|hyper/i.test(base);
  const isXL = /sdxl|xl/i.test(base) || isLightning;
  const isV2 = /v2-1|v2\.1/i.test(base);
  const fewStep = isLightning || isTurbo;
  if (fewStep) {
    // Approved config: 10 steps, cfg 2, dpm++2m, KARRAS, 512², FULL VAE (taesd
    // blanks at high res; 512 full-VAE decodes in ~6s). ~30s warm on an M4.
    return { defaultSize: 512, defaultSteps: 10, defaultCfg: 2, sampler: 'dpm++2m', scheduler: 'karras', fewStep, isXL };
  }
  // Full (non-distilled) checkpoints: many steps, real CFG, engine-default schedule.
  const defaultSize = isXL ? 1024 : isV2 ? 768 : 512;
  return { defaultSize, defaultSteps: 28, defaultCfg: 7, sampler: 'dpm++2m', scheduler: 'discrete', fewStep, isXL };
}

/** Quality tier the user can pick in the composer. 'fast' is the default (~30s
 *  at 512²); 'quality' renders at the model's native resolution (crisper, but
 *  ~3× slower on an M4). Only meaningful for distilled few-step models — full
 *  models already run at native res. */
export type ImageTier = 'fast' | 'quality';

export interface TierResolved {
  width: number;
  height: number;
  steps: number;
}

/** Resolve the size + steps for a model at a given tier. Distilled models get the
 *  fast 512 recipe by default, or their native 1024 in 'quality'; full models
 *  ignore the tier (always native). Steps come from the model recipe (+2 at the
 *  quality tier for the extra resolution's detail). Pure. */
export function resolveTier(baseName: string, tier: ImageTier): TierResolved {
  const d = standardModelDefaults(baseName);
  if (d.fewStep && tier === 'quality') {
    const size = d.isXL ? 1024 : 768;
    return { width: size, height: size, steps: d.defaultSteps + 2 };
  }
  return { width: d.defaultSize, height: d.defaultSize, steps: d.defaultSteps };
}

/** The Tiny AutoEncoder (TAESD) filename that matches a checkpoint's family.
 *  TAESD is a tiny drop-in VAE that decodes fast but softens detail and BLANKS at
 *  1024 (it overflows), so it's opt-in only (fast low-res drafts), never the
 *  default. SDXL needs the SDXL-specific decoder (taesdxl); SD1.5/SD2 use the base
 *  taesd. The file is fetched separately (madebyollin/taesd*). Pure. */
export function taesdFilename(baseName: string): string {
  return standardModelDefaults(baseName).isXL ? 'taesdxl.safetensors' : 'taesd.safetensors';
}
