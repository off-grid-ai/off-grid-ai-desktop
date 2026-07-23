// Model filtering + sorting, ported from Off Grid Mobile so desktop has the same
// filters (org / type / source / size / quant) and sorts (recommended / best-fit
// / downloads / size / recency). Pure logic over a normalized FilterableModel;
// the UI renders the option lists and feeds the FilterState.

import type { Credibility } from './credibility'

export type ModelTypeFilter = 'all' | 'text' | 'vision' | 'code' | 'image-gen'
export type CredibilityFilter = 'all' | Credibility
export type SizeFilter = 'all' | 'tiny' | 'small' | 'medium' | 'large'
export type SortOption = 'recommended' | 'bestfit' | 'size' | 'downloads' | 'recency'

export interface FilterState {
  orgs: string[]
  type: ModelTypeFilter
  source: CredibilityFilter
  size: SizeFilter
  quant: string // 'all' or a quant label
  sort: SortOption
}

export const initialFilterState: FilterState = {
  orgs: [],
  type: 'all',
  source: 'all',
  size: 'all',
  quant: 'all',
  sort: 'recommended'
}

/** Normalized model the filters/sorts operate on (map HF results into this). */
export interface FilterableModel {
  id: string
  name: string
  org: string
  credibility?: Credibility
  params?: number | null
  tags?: string[]
  downloads?: number
  likes?: number
  lastModified?: string
  minRamGb?: number
  files?: { sizeBytes?: number; quant?: string }[]
}

export const SIZE_OPTIONS = [
  { key: 'tiny', label: 'Tiny (<2B)', min: 0, max: 2 },
  { key: 'small', label: 'Small (2-5B)', min: 2, max: 5 },
  { key: 'medium', label: 'Medium (5-15B)', min: 5, max: 15 },
  { key: 'large', label: 'Large (15B+)', min: 15, max: Infinity }
] as const

export const MODEL_TYPE_OPTIONS = [
  { key: 'text', label: 'Text' },
  { key: 'vision', label: 'Vision' },
  { key: 'code', label: 'Code' },
  { key: 'image-gen', label: 'Image' }
] as const

export const CREDIBILITY_OPTIONS = [
  { key: 'offgrid', label: 'Off Grid' },
  { key: 'official', label: 'Official' },
  { key: 'verified-quantizer', label: 'Verified' },
  { key: 'community', label: 'Community' }
] as const

export const SORT_OPTIONS = [
  { key: 'recommended', label: 'Recommended' },
  { key: 'bestfit', label: 'Best fit' },
  { key: 'downloads', label: 'Downloads' },
  { key: 'size', label: 'Size' },
  { key: 'recency', label: 'Recent' }
] as const

// Matches a parameter count with a B (billions) or M (millions) unit, e.g.
// "2.2B", "500M", "256m". M is normalized to billions (500M -> 0.5).
const PARAM_RE = /\b(\d+(?:\.\d+)?)\s?([BbMm])\b/

/** Parse a billions-of-parameters count from a model name/id, in billions
 *  ("Qwen3.5-2B" -> 2, "SmolVLM2-500M" -> 0.5). Returns null if none found. */
export function parseParamCount(nameOrId: string): number | null {
  const m = PARAM_RE.exec(nameOrId)
  if (!m) return null
  const n = Number.parseFloat(m[1])
  return /[Mm]/.test(m[2]) ? n / 1000 : n
}

/** Detect a model's type from its name + tags. */
export function getModelType(name: string, tags: string[] = []): ModelTypeFilter {
  const n = name.toLowerCase()
  const t = tags.map((x) => x.toLowerCase())
  if (
    t.some(
      (x) =>
        x.includes('diffusion') ||
        x.includes('text-to-image') ||
        x.includes('image-generation') ||
        x.includes('diffusers')
    ) ||
    n.includes('stable-diffusion') ||
    n.includes('sd-') ||
    n.includes('sdxl') ||
    n.includes('flux')
  )
    return 'image-gen'
  if (
    t.some((x) => x.includes('vision') || x.includes('multimodal') || x.includes('image-text')) ||
    n.includes('vision') ||
    n.includes('vlm') ||
    n.includes('-vl') ||
    n.includes('llava')
  )
    return 'vision'
  if (t.some((x) => x.includes('code')) || n.includes('code') || n.includes('coder')) return 'code'
  return 'text'
}

/** Lower is better. Ideal model uses ~40% of RAM; penalize >75% (too slow). */
export function bestFitScore(m: FilterableModel, ramGb: number): number {
  const params = m.params ?? parseParamCount(m.name) ?? parseParamCount(m.id) ?? 0
  const minRam = m.minRamGb ?? params * 0.75
  const ratio = ramGb ? minRam / ramGb : 0
  const penalty = ratio > 0.75 ? (ratio - 0.75) * 4 : 0
  return Math.abs(ratio - 0.4) + penalty
}

export function hasActiveFilters(state: FilterState): boolean {
  return (
    state.orgs.length > 0 ||
    state.type !== 'all' ||
    state.source !== 'all' ||
    state.size !== 'all' ||
    state.quant !== 'all'
  )
}

export function applyFilters<T extends FilterableModel>(models: T[], state: FilterState): T[] {
  return models.filter((m) => {
    if (state.source !== 'all' && m.credibility !== state.source) return false
    if (state.type !== 'all' && getModelType(m.name, m.tags) !== state.type) return false
    if (state.orgs.length > 0 && !state.orgs.includes(m.org)) return false
    if (state.size !== 'all') {
      const p = m.params ?? parseParamCount(m.name) ?? parseParamCount(m.id)
      const opt = SIZE_OPTIONS.find((s) => s.key === state.size)
      // Exclude when out of range — and when the size is unknowable, since the
      // user explicitly asked for a size band (don't leak unsized models in).
      if (opt && (p == null || p < opt.min || p >= opt.max)) return false
    }
    if (state.quant !== 'all' && m.files && m.files.length > 0) {
      if (!m.files.some((f) => f.quant === state.quant)) return false
    }
    return true
  })
}

export function applySort<T extends FilterableModel>(
  models: T[],
  sort: SortOption,
  ramGb = 0
): T[] {
  if (sort === 'recommended') return models
  const arr = [...models]
  const p = (m: FilterableModel): number => m.params ?? parseParamCount(m.name) ?? 0
  switch (sort) {
    case 'bestfit':
      return arr.sort((a, b) => bestFitScore(a, ramGb) - bestFitScore(b, ramGb))
    case 'size':
      return arr.sort((a, b) => p(a) - p(b))
    case 'downloads':
      return arr.sort((a, b) => (b.downloads ?? 0) - (a.downloads ?? 0))
    case 'recency':
      return arr.sort((a, b) => (b.lastModified ?? '').localeCompare(a.lastModified ?? ''))
    default:
      return arr
  }
}

/** Apply filters then sort in one pass. */
export function filterAndSort<T extends FilterableModel>(
  models: T[],
  state: FilterState,
  ramGb = 0
): T[] {
  return applySort(applyFilters(models, state), state.sort, ramGb)
}
