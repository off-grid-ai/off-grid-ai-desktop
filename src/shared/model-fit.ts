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
