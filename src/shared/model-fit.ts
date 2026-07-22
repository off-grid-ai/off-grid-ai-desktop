// Single source of truth for the RAM-fit verdict, shared by the MAIN process
// (model-sizing.ts) and the RENDERER (Models screen badge). Both must agree, or
// the badge on a card says one thing while the activation warning says another.
// Pure, no imports — safe for either bundle.

export type FitLevel = 'ok' | 'tight' | 'risky'

// Weights as a fraction of total RAM: at/under OK is comfortable, at/under TIGHT
// works but context gets squeezed, above is risky (slow / may need Load anyway).
export const FIT_OK_FRAC = 0.38
export const FIT_TIGHT_FRAC = 0.55

/** RAM-fit verdict for a model's weights (GB) on a machine with `ramGb` total. */
export function fitLevel(weightsGb: number, ramGb: number): FitLevel {
  if (weightsGb <= ramGb * FIT_OK_FRAC) return 'ok'
  return weightsGb <= ramGb * FIT_TIGHT_FRAC ? 'tight' : 'risky'
}

// --- Four-way browse chip (shared with the never-block loader) ---
// SOFT = the balanced comfort budget fraction of RAM; CEIL = the aggressive
// (extreme) ceiling. These are the SAME fractions modeBudget uses for balanced /
// extreme (model-sizing imports them), so the browse chip and the loader agree.
export const FIT_SOFT_FRAC = 0.65
export const FIT_CEIL_FRAC = 0.82

export type FitTier = 'easy' | 'fits' | 'tight' | 'wontFit'

/** Four-way fit chip for the browse UI. A model past the aggressive ceiling is the
 *  ONLY one labelled "won't fit"; everything up to it stays loadable (with a
 *  warning + Load anyway) — the never-block posture. */
export function fitTier(weightsGb: number, ramGb: number): FitTier {
  const soft = ramGb * FIT_SOFT_FRAC
  const ceil = ramGb * FIT_CEIL_FRAC
  if (weightsGb < soft * 0.6) return 'easy'
  if (weightsGb < soft) return 'fits'
  if (weightsGb < ceil) return 'tight'
  return 'wontFit'
}

/** True when the machine could load this model at all (up to the aggressive
 *  ceiling) — so browse never hides a model that's loadable via Load anyway. */
export function isLoadableOnDevice(weightsGb: number, ramGb: number): boolean {
  return fitTier(weightsGb, ramGb) !== 'wontFit'
}
