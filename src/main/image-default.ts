// Pure RAM-aware default-image-model selection. Extracted so the resolver's
// "which model does a fresh user get?" decision is unit-testable WITHOUT os/fs/
// Electron. No side effects, no imports.
//
// Rule (only applied when the user has made NO explicit pick): prefer DreamShaper
// (the versatile default), and among its two quants pick the LIGHT (Q4) one on a
// memory-constrained Mac, the FULL (Q8) one otherwise. Verified: the Q8 pegs
// memory (~4.7GB peak) and can freeze a 16GB Mac; the Q4 (~3.08GB peak) does not.

/** RAM (GB) at or below which the lighter (Q4) DreamShaper quant is the default.
 *  ~17 so a machine reporting slightly under 16 "real" GB (os.totalmem is ~16.0)
 *  still lands on Light; a 24/32GB Mac gets the full Q8. */
export const DEFAULT_LIGHT_QUANT_RAM_CEILING_GB = 17;

/** Is a filename the light (Q4) DreamShaper quant? (vs the full Q8.) */
const isDreamshaper = (f: string): boolean => /dreamshaper/i.test(f);
const isLightQuant = (f: string): boolean => /q4/i.test(f);

/**
 * The default image model FILENAME for a machine, given the installed image-model
 * filenames and total RAM (GB) — or null to fall through to the caller's generic
 * heuristic (juggernaut > z-image > lightning > ...). Only picks among DreamShaper
 * quants that are actually installed:
 *   - RAM <= ceiling → the installed Light (Q4) DreamShaper, else the full one;
 *   - RAM >  ceiling → the installed full (Q8) DreamShaper, else the Light one.
 * Returns null when no DreamShaper quant is installed (nothing to prefer).
 */
export function defaultImageModelFilename(installed: string[], ramGb: number): string | null {
  const dreamshapers = installed.filter(isDreamshaper);
  if (!dreamshapers.length) return null;
  const light = dreamshapers.find(isLightQuant);
  const full = dreamshapers.find((f) => !isLightQuant(f));
  if (ramGb <= DEFAULT_LIGHT_QUANT_RAM_CEILING_GB) return light ?? full ?? dreamshapers[0];
  return full ?? light ?? dreamshapers[0];
}
