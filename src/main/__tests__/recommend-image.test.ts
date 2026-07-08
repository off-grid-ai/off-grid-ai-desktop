import { describe, it, expect } from 'vitest';
import { recommendedImageModelId, LIGHT_MODEL_RAM_CEILING_GB, CATALOG } from '@offgrid/models';
import type { ModelEntry } from '@offgrid/models';

// The two DreamShaper quants must ship as distinct catalog entries with distinct
// ids + filenames, tagged full vs Light — the whole recommendation keys off that.
const full = CATALOG.find((m) => m.id === 'offgrid-ai/dreamshaper-xl-v2-turbo-GGUF')!;
const light = CATALOG.find((m) => m.id === 'offgrid-ai/dreamshaper-xl-v2-turbo-GGUF-Q4')!;

describe('DreamShaper quant catalog entries', () => {
  it('ships both quants as distinct image models', () => {
    expect(full).toBeTruthy();
    expect(light).toBeTruthy();
    expect(full.kind).toBe('image');
    expect(light.kind).toBe('image');
  });
  it('has distinct ids and distinct primary filenames', () => {
    expect(full.id).not.toBe(light.id);
    expect(full.files[0].name).not.toBe(light.files[0].name);
    expect(full.files[0].name).toMatch(/Q8/i);
    expect(light.files[0].name).toMatch(/Q4/i);
  });
  it('tags the light quant Light (and both Versatile+Fast)', () => {
    expect(light.tags).toEqual(expect.arrayContaining(['Versatile', 'Fast', 'Light']));
    expect(full.tags).toEqual(expect.arrayContaining(['Versatile', 'Fast']));
    expect(full.tags).not.toContain('Light');
  });
  it('the light quant is smaller on disk', () => {
    expect(light.files[0].sizeBytes!).toBeLessThan(full.files[0].sizeBytes!);
  });
});

describe('recommendedImageModelId', () => {
  const models: ModelEntry[] = [full, light];

  it('recommends the Light quant at or below the RAM ceiling (16GB)', () => {
    expect(recommendedImageModelId(models, 16)).toBe(light.id);
    expect(recommendedImageModelId(models, 8)).toBe(light.id);
    expect(recommendedImageModelId(models, LIGHT_MODEL_RAM_CEILING_GB)).toBe(light.id);
  });

  it('recommends the full quant above the RAM ceiling', () => {
    expect(recommendedImageModelId(models, 24)).toBe(full.id);
    expect(recommendedImageModelId(models, 32)).toBe(full.id);
    expect(recommendedImageModelId(models, 64)).toBe(full.id);
  });

  it('keys off the Light tag, not the model name', () => {
    const genericFull: ModelEntry = { id: 'x/base-GGUF', name: 'Base', kind: 'image', tags: ['Fast'], files: [{ name: 'base-Q8.gguf', url: '' }] };
    const genericLight: ModelEntry = { id: 'x/base-GGUF-Q4', name: 'Base Light', kind: 'image', tags: ['Fast', 'Light'], files: [{ name: 'base-Q4.gguf', url: '' }] };
    expect(recommendedImageModelId([genericFull, genericLight], 16)).toBe(genericLight.id);
    expect(recommendedImageModelId([genericFull, genericLight], 32)).toBe(genericFull.id);
  });

  it('returns null when RAM is unknown or no image model exists', () => {
    expect(recommendedImageModelId(models, null)).toBeNull();
    expect(recommendedImageModelId(models, undefined)).toBeNull();
    expect(recommendedImageModelId([], 16)).toBeNull();
    const textOnly: ModelEntry = { id: 't', name: 'T', kind: 'text', files: [] };
    expect(recommendedImageModelId([textOnly], 16)).toBeNull();
  });

  it('falls back to any image model when only a Light (or only a full) exists', () => {
    // Small machine, only a full model installed -> recommend it (nothing lighter).
    expect(recommendedImageModelId([full], 16)).toBe(full.id);
    // Big machine, only a Light model of its family -> its full sibling absent, so Light.
    expect(recommendedImageModelId([light], 32)).toBe(light.id);
  });

  it('prefers the Versatile all-rounder when several Light models exist (order-independent)', () => {
    // Other families' Light entries listed BEFORE the versatile one — the badge
    // must still land on the Versatile (DreamShaper) family, not the first Light.
    const otherLight: ModelEntry = { id: 'x/photo-GGUF-Q4', name: 'Photo Light', kind: 'image', tags: ['Photoreal', 'Light'], files: [{ name: 'photo-Q4.gguf', url: '' }] };
    const otherFull: ModelEntry = { id: 'x/photo-GGUF', name: 'Photo', kind: 'image', tags: ['Photoreal'], files: [{ name: 'photo-Q8.gguf', url: '' }] };
    const many = [otherFull, otherLight, full, light];
    expect(recommendedImageModelId(many, 16)).toBe(light.id);   // versatile Light
    expect(recommendedImageModelId(many, 32)).toBe(full.id);    // versatile full
  });

  it('lists a Light variant for every offgrid image model in the catalog', () => {
    const imageFamilies = CATALOG.filter((m) => m.kind === 'image' && m.id.startsWith('offgrid-ai/') && !/-Q4$/.test(m.id));
    for (const fam of imageFamilies) {
      const hasLight = CATALOG.some((m) => m.id === `${fam.id}-Q4` && (m.tags ?? []).includes('Light'));
      expect(hasLight, `${fam.id} should have a Light (-Q4) sibling`).toBe(true);
    }
  });
});
