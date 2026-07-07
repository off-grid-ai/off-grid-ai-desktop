/**
 * Locks the per-model generation defaults — the single source of truth shared by
 * BOTH image runtimes (persistent sd-server + one-shot sd-cli). The rule that
 * matters for quality: a FULL (non-distilled) checkpoint like animagine must keep
 * its ~28-step / real-CFG budget (dropping steps wrecks the image), while a
 * distilled Lightning/Turbo model is a few-step, cfg≈1 model.
 */
import { describe, it, expect } from 'vitest';
import { standardModelDefaults, taesdFilename } from '../image-defaults';

describe('standardModelDefaults', () => {
  it('keeps full SDXL (animagine) at high quality: 1024, 28 steps, real CFG, dpm++2m', () => {
    const d = standardModelDefaults('animagine-xl-4.0-Q8_0.gguf');
    expect(d.isXL).toBe(true);
    expect(d.fewStep).toBe(false);
    expect(d.defaultSize).toBe(1024);
    expect(d.defaultSteps).toBe(28);
    expect(d.defaultCfg).toBe(7);
    expect(d.sampler).toBe('dpm++2m');
  });

  it('treats SDXL-Lightning as a few-step model: 768, 4 steps, cfg 1, euler', () => {
    const d = standardModelDefaults('sdxl-lightning-4step.gguf');
    expect(d.fewStep).toBe(true);
    expect(d.defaultSize).toBe(768);
    // The filename names its own step budget.
    expect(d.defaultSteps).toBe(4);
    expect(d.defaultCfg).toBe(1.0);
    expect(d.sampler).toBe('euler');
  });

  it('honors a named step budget on a lightning model (8step)', () => {
    expect(standardModelDefaults('animagine-lightning-8step.gguf').defaultSteps).toBe(8);
  });

  it('treats turbo as few-step at 512', () => {
    const d = standardModelDefaults('sd-turbo.gguf');
    expect(d.fewStep).toBe(true);
    expect(d.defaultSize).toBe(512);
    expect(d.defaultSteps).toBe(4);
  });

  it('defaults a plain SD1.5 checkpoint to 512 / 28 steps', () => {
    const d = standardModelDefaults('dreamshaper_8.safetensors');
    expect(d.isXL).toBe(false);
    expect(d.defaultSize).toBe(512);
    expect(d.defaultSteps).toBe(28);
  });
});

describe('taesdFilename', () => {
  it('uses the SDXL-specific decoder for XL models', () => {
    expect(taesdFilename('animagine-xl-4.0-Q8_0.gguf')).toBe('taesdxl.safetensors');
    expect(taesdFilename('sdxl-lightning-4step.gguf')).toBe('taesdxl.safetensors');
  });
  it('uses the base decoder for SD1.5 / non-XL models', () => {
    expect(taesdFilename('dreamshaper_8.safetensors')).toBe('taesd.safetensors');
  });
});
