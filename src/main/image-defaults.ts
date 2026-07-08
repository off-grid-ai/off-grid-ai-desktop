// Per-model generation defaults for stable-diffusion.cpp checkpoints.
//
// Pure (no IO) so it's unit-testable and used as the SINGLE source of truth by
// BOTH image runtimes — the persistent sd-server fast path and the one-shot
// sd-cli path in imagegen.ts. Keeping it in one place stops the two paths from
// drifting apart (e.g. one defaulting SDXL to 1024 while the other uses 768).
//
// The defaults encode the quality/speed tradeoff measured on an M4:
// - Distilled few-step models (SDXL-Lightning, *-Turbo, DMD2) render 5-star at
//   8 steps / cfg 2 IF the KARRAS sigma schedule is used. The default `discrete`
//   schedule undercooks few-step sigmas → smeared/painterly output (this was the
//   single biggest quality bug). 4 steps is too few (rainbow artifacts); 8 is the
//   crisp floor. At 512² this is ~12s warm on the persistent server.
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
    // blanks at high res; 512 full-VAE decodes in ~6s). ~30s warm on an M4 at
    // good quality. (1024 is crisper but ~90s — offered as a separate quality tier.)
    return { defaultSize: 512, defaultSteps: 10, defaultCfg: 2, sampler: 'dpm++2m', scheduler: 'karras', fewStep, isXL };
  }
  // Full (non-distilled) checkpoints: many steps, real CFG, engine-default schedule.
  const defaultSize = isXL ? 1024 : isV2 ? 768 : 512;
  return { defaultSize, defaultSteps: 28, defaultCfg: 7, sampler: 'dpm++2m', scheduler: 'discrete', fewStep, isXL };
}

/** The Tiny AutoEncoder (TAESD) filename that matches a checkpoint's family.
 *  TAESD is a tiny drop-in VAE that decodes latents in well under a second
 *  instead of the full VAE's multi-second (and on Metal, pathologically slow at
 *  ≥768px) decode. SDXL needs the SDXL-specific decoder (taesdxl); SD1.5/SD2 use
 *  the base taesd. The file itself is fetched separately (madebyollin/taesd*),
 *  stored under the models dir with these canonical names. Pure. */
export function taesdFilename(baseName: string): string {
  return standardModelDefaults(baseName).isXL ? 'taesdxl.safetensors' : 'taesd.safetensors';
}
