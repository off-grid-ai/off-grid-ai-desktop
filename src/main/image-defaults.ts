// Per-model generation defaults for stable-diffusion.cpp checkpoints.
//
// Pure (no IO) so it's unit-testable and used as the SINGLE source of truth by
// BOTH image runtimes — the persistent sd-server fast path and the one-shot
// sd-cli path in imagegen.ts. Keeping it in one place stops the two paths from
// drifting apart (e.g. one defaulting SDXL to 1024 while the other uses 768).
//
// The defaults encode the quality/speed tradeoff learned per model family:
// distilled few-step models (SDXL-Lightning, *-Turbo) look great at ~4 steps
// with cfg≈1 and euler; full (non-distilled) checkpoints need ~28 steps and real
// CFG for quality — dropping their step count wrecks the image.

export interface StandardModelDefaults {
  /** Default square size (px). SDXL is trained at 1024; distilled/SD1.5 smaller. */
  defaultSize: number;
  /** Denoising steps. Full checkpoints need many; distilled models are few-step. */
  defaultSteps: number;
  /** Classifier-free guidance scale. 1.0 = CFG off (fast, for distilled models). */
  defaultCfg: number;
  /** Sampling method. */
  sampler: string;
  /** Whether this is a distilled few-step model (Lightning/Turbo). */
  fewStep: boolean;
  /** Whether this is an SDXL-family model (larger native resolution). */
  isXL: boolean;
}

/** Resolve the generation defaults for a checkpoint from its filename. */
export function standardModelDefaults(baseName: string): StandardModelDefaults {
  const base = baseName;
  const isLightning = /lightning/i.test(base);
  const isTurbo = /turbo/i.test(base);
  const isXL = /sdxl|xl/i.test(base) || isLightning;
  const isV2 = /v2-1|v2\.1/i.test(base);
  const fewStep = isLightning || isTurbo;
  // A model can name its own step budget (e.g. "…-8step.gguf").
  const nameStepMatch = base.match(/(\d+)\s*step/i);
  // SDXL-Lightning's sweet spot is 768 (great quality, freeze-safe); full XL
  // stays at 1024 where the detail pays off; turbo/SD1.5 default to 512.
  const defaultSize = isTurbo ? 512 : isLightning ? 768 : isXL ? 1024 : isV2 ? 768 : 512;
  const defaultSteps = isTurbo ? 4 : isLightning ? (nameStepMatch ? parseInt(nameStepMatch[1], 10) : 4) : 28;
  const defaultCfg = fewStep ? 1.0 : 7;
  const sampler = fewStep ? 'euler' : 'dpm++2m';
  return { defaultSize, defaultSteps, defaultCfg, sampler, fewStep, isXL };
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
