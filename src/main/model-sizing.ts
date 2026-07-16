// Pure model-sizing math, extracted so the freeze-fix logic and model selection
// are unit-testable WITHOUT Electron/os/fs. No side effects, no imports.
//
// These functions encode two regressions we lived through:
//   1. A hardcoded 64K context that overcommitted unified memory → macOS froze.
//      computeSafeCtx() clamps context to what RAM can hold.
//   2. "Configure for me" picking the LARGEST fitting model (an 8B at 64K froze a
//      16GB Mac). chooseChatModel() picks the largest that fits COMFORTABLY.

export type KvCacheType = 'f16' | 'q8_0' | 'q4_0'
export type PerformanceMode = 'conservative' | 'balanced' | 'extreme'

export interface SizingModel {
  id?: string
  kind: string
  params?: number
  minRamGb?: number
  files?: { sizeBytes?: number }[]
}

/** Conservative KV-cache cost per 1k tokens (~8B-class). Quantized KV roughly
 *  halves (q8_0) / quarters (q4_0) the footprint. Overestimating is the safe way. */
export function kvPerKTokGb(kv: KvCacheType): number {
  return kv === 'q4_0' ? 0.05 : kv === 'q8_0' ? 0.085 : 0.16
}

/** RAM budget fraction + reserved headroom (GB) for a resource-usage mode. */
export function modeBudget(mode: PerformanceMode): { frac: number; reserveGb: number } {
  switch (mode) {
    case 'conservative':
      return { frac: 0.45, reserveGb: 2.0 }
    case 'extreme':
      return { frac: 0.82, reserveGb: 1.0 }
    default:
      return { frac: 0.65, reserveGb: 1.5 }
  }
}

/** Clamp a requested context window to what this machine + model can hold without
 *  overcommitting unified memory. Returns a value in [2048, requested], rounded
 *  down to a 1k boundary. */
export function computeSafeCtx(opts: {
  requested: number
  totalGb: number
  weightsGb: number
  kvType: KvCacheType
  frac: number
  reserveGb: number
}): number {
  const { requested, totalGb, weightsGb, kvType, frac, reserveGb } = opts
  const kvBudgetGb = Math.max(0.5, totalGb * frac - weightsGb - reserveGb)
  const cap = Math.floor((kvBudgetGb / kvPerKTokGb(kvType)) * 1000)
  const safe = Math.max(2048, Math.min(requested, cap))
  return Math.floor(safe / 1024) * 1024
}

/** Total on-disk size (bytes) of a model's files. */
export function totalBytes(m: SizingModel): number {
  return (m.files ?? []).reduce((s, f) => s + (f.sizeBytes ?? 0), 0)
}

/** The RECOMMENDED parameter size for a default pick by RAM + mode — distinct from
 *  the absolute max a machine *could* run. A 16GB Mac should default to a ~4B model,
 *  not the 8B it can technically load (an 8B at a big context froze a 16GB Mac, and
 *  even when safe it's heavy). Disk size alone can't separate 4B from 8B (similar
 *  bytes), so we cap by params. Conservative steps down a tier; Extreme steps up. */
export function recommendedParamCeiling(ramGb: number, mode: PerformanceMode): number {
  // Hard RAM envelope: an 8B only makes sense at 24GB+. So 8–16GB stays at 4B in
  // EVERY mode (Extreme included) — Extreme on 16GB must not jump to an 8B.
  if (mode === 'conservative') {
    if (ramGb < 8) return 1.5
    if (ramGb < 24) return 2 // 16GB conservative → ~2B
    if (ramGb < 32) return 4 // 24GB conservative → 4B
    return 8 // 32GB+ conservative → 8B
  }
  if (mode === 'extreme') {
    if (ramGb < 24) return 4 // 16GB extreme → still 4B (NOT 8B)
    if (ramGb < 32) return 8 // 24GB
    if (ramGb < 48) return 14 // 32GB
    return 32
  }
  // balanced
  if (ramGb < 8) return 2
  if (ramGb < 24) return 4 // 8–16GB → 4B
  if (ramGb < 32) return 8 // 24GB → 8B
  if (ramGb < 48) return 14 // 32GB → ~13B
  return 32 // 48GB+
}

/** Curated default model ids by RAM + mode, tried before the size heuristic. A
 *  16GB Mac defaults to Gemma 4 E2B (light, fast, ~3GB). Returns [] for tiers we
 *  leave to chooseChatModel. Each id is still weight-budget-checked by the caller,
 *  so a curated pick that wouldn't fit falls through to the heuristic. */
export function preferredModelIds(ramGb: number, mode: PerformanceMode): string[] {
  if (ramGb < 24) {
    // Prefer VISION models so the "Vision" capability actually works. The only
    // on-device vision models that fit ≤16GB are Qwen3-VL-2B (~1.9GB) and Gemma 4
    // E4B (~6GB). Conservative → light 2B; balanced & extreme → Gemma 4 E4B
    // (strong reasoning + vision, fits a 16GB Mac), with the 2B as a fallback when
    // the weight budget is too tight.
    if (mode === 'conservative')
      return ['unsloth/Qwen3-VL-2B-Instruct-GGUF', 'unsloth/Qwen3.5-0.8B-GGUF']
    return ['unsloth/gemma-4-E4B-it-GGUF', 'unsloth/Qwen3-VL-2B-Instruct-GGUF'] // balanced + extreme → E4B, 2B fallback
  }
  return [] // 24GB+ → size heuristic (chooseChatModel)
}

/** RAM-fit verdict for a model's weights on a machine: comfy / tight / risky. */
export function fitLevel(weightsGb: number, ramGb: number): 'ok' | 'tight' | 'risky' {
  return weightsGb <= ramGb * 0.38 ? 'ok' : weightsGb <= ramGb * 0.55 ? 'tight' : 'risky'
}

/** Pick the best chat/vision model that fits COMFORTABLY in RAM: prefer vision,
 *  then the largest whose weights are within `frac` of total RAM. Falls back to the
 *  smallest param-eligible model, then the smallest text model. null if none. */
export function chooseChatModel(
  models: SizingModel[],
  ramGb: number,
  maxParams: number,
  frac: number
): SizingModel | null {
  const weightBudget = ramGb * frac * 1e9
  const eligible = (m: SizingModel): boolean =>
    (m.kind === 'text' || m.kind === 'vision') &&
    (m.params ?? 999) <= maxParams &&
    (m.minRamGb ?? 0) <= ramGb
  const byPreference = (a: SizingModel, b: SizingModel): number =>
    Number(b.kind === 'vision') - Number(a.kind === 'vision') || (b.params ?? 0) - (a.params ?? 0)

  const comfy = models
    .filter((m) => eligible(m) && totalBytes(m) <= weightBudget)
    .sort(byPreference)
  return (
    comfy[0] ??
    models.filter(eligible).sort((a, b) => totalBytes(a) - totalBytes(b))[0] ??
    models.filter((m) => m.kind === 'text').sort((a, b) => totalBytes(a) - totalBytes(b))[0] ??
    null
  )
}
