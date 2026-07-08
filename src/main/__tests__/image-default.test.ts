import { describe, it, expect } from 'vitest';
import { defaultImageModelFilename, DEFAULT_LIGHT_QUANT_RAM_CEILING_GB } from '../image-default';

const Q8 = 'dreamshaper-xl-v2-turbo-Q8_0.gguf';
const Q4 = 'dreamshaper-xl-v2-turbo-Q4_K.gguf';
const OTHER = 'juggernaut-xl-v9-Q8_0.gguf';

describe('defaultImageModelFilename (RAM -> DreamShaper quant)', () => {
  it('prefers the Light Q4 quant at or below the RAM ceiling', () => {
    expect(defaultImageModelFilename([Q8, Q4, OTHER], 16)).toBe(Q4);
    expect(defaultImageModelFilename([Q8, Q4], 8)).toBe(Q4);
    expect(defaultImageModelFilename([Q8, Q4], DEFAULT_LIGHT_QUANT_RAM_CEILING_GB)).toBe(Q4);
    // A 16GB Mac reports os.totalmem ~16.0; the ~17 ceiling still lands on Light.
    expect(defaultImageModelFilename([Q8, Q4], 16.0)).toBe(Q4);
  });

  it('prefers the full Q8 quant above the RAM ceiling', () => {
    expect(defaultImageModelFilename([Q8, Q4, OTHER], 24)).toBe(Q8);
    expect(defaultImageModelFilename([Q8, Q4], 32)).toBe(Q8);
    expect(defaultImageModelFilename([Q8, Q4], 64)).toBe(Q8);
  });

  it('falls back to whichever quant is installed when only one is present', () => {
    // Big machine, only the light quant installed -> use it (nothing fuller).
    expect(defaultImageModelFilename([Q4], 32)).toBe(Q4);
    // Small machine, only the full quant installed -> use it (nothing lighter).
    expect(defaultImageModelFilename([Q8], 16)).toBe(Q8);
  });

  it('returns null when no DreamShaper quant is installed (defer to generic heuristic)', () => {
    expect(defaultImageModelFilename([OTHER], 16)).toBeNull();
    expect(defaultImageModelFilename([], 16)).toBeNull();
    expect(defaultImageModelFilename(['sdxl_lightning_4step.q8_0.gguf'], 32)).toBeNull();
  });
});
