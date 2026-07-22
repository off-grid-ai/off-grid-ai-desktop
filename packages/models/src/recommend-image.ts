// Pure "recommended image model for this machine" decision. Extracted so the
// rule is defined ONCE and unit-tested WITHOUT any UI/Electron. No side effects.
//
// The rule keys off the 'Light' tag (a smaller/lower-memory quant) + kind ===
// 'image', NOT a model name — adding another paired full/light quant needs zero
// changes here. On a memory-constrained Mac (<= threshold) recommend the Light
// variant of a model that also ships a full variant; above the threshold prefer
// the full (non-Light) variant of that same family.

/** The minimal shape the recommendation reads — id, kind, tags. Structural so
 *  callers can pass either the package `ModelEntry` or a renderer-local model type
 *  (whose `kind` is a plain string) without a cast. */
export interface RecommendableModel {
  id: string
  kind: string
  tags?: string[]
}

/** RAM (GB) at or below which the lighter (Light-tagged) quant is recommended.
 *  16GB is the ceiling: verified that the full Q8 DreamShaper pegs memory (~4.7GB
 *  peak) and can freeze a 16GB Mac, while the Q4 (~3.08GB peak) does not. */
export const LIGHT_MODEL_RAM_CEILING_GB = 16

const hasLightTag = (m: RecommendableModel): boolean =>
  (m.tags ?? []).some((t) => /^light$/i.test(t))

const isVersatile = (m: RecommendableModel): boolean =>
  (m.tags ?? []).some((t) => /^versatile$/i.test(t))

/** Prefer the 'Versatile' all-rounder (DreamShaper) when several models qualify,
 *  so the badge is stable no matter how many Light variants the catalog lists /
 *  their order. Falls back to the first candidate. */
const pickVersatileFirst = (candidates: RecommendableModel[]): RecommendableModel | undefined =>
  candidates.find(isVersatile) ?? candidates[0]

/** Family key for pairing a full quant with its Light sibling: the id with any
 *  trailing quant suffix (e.g. "-Q4") stripped, so both DreamShaper entries map
 *  to the same family. */
const familyKey = (m: RecommendableModel): string => m.id.replace(/-Q\d[\w]*$/i, '')

/**
 * The image model id best suited to a machine with `ramGb` RAM, or null when no
 * image model qualifies. General over the 'Light' tag:
 *   - ramGb <= LIGHT_MODEL_RAM_CEILING_GB → prefer a Light-tagged image model;
 *   - ramGb >  ceiling                    → prefer the full (non-Light) sibling
 *                                            of a family that HAS a Light variant.
 * The "has a Light sibling" constraint keeps the badge on the versatile default
 * family (DreamShaper) rather than an unrelated heavy model. Falls back to any
 * Light model when only that exists (small machine) / the family's full entry.
 */
export function recommendedImageModelId(
  models: RecommendableModel[],
  ramGb: number | null | undefined
): string | null {
  if (!ramGb || !Number.isFinite(ramGb)) return null
  const images = models.filter((m) => m.kind === 'image')
  if (!images.length) return null

  const light = images.filter(hasLightTag)
  // Families that ship a Light variant — those are the ones we recommend within.
  const lightFamilies = new Set(light.map(familyKey))
  const fullOfLightFamily = images.filter((m) => !hasLightTag(m) && lightFamilies.has(familyKey(m)))

  if (ramGb <= LIGHT_MODEL_RAM_CEILING_GB) {
    return (pickVersatileFirst(light) ?? images[0]).id
  }
  // Above the ceiling: the full sibling of a Light family, else any non-Light image model.
  return (pickVersatileFirst(fullOfLightFamily) ?? images.find((m) => !hasLightTag(m)) ?? images[0])
    .id
}
