import { useCallback, useEffect, useRef, useState } from 'react'
import {
  IconDownload,
  IconCircleCheck,
  IconLoader2,
  IconSearch,
  IconChevronDown,
  IconCheck,
  IconX,
  IconTrash,
  IconUpload,
  IconInfoCircle,
  IconExternalLink,
  IconEye,
  IconDatabase,
  IconStarFilled,
  IconClock
} from '@tabler/icons-react'
import { StoragePanel } from './setup/StoragePanel'
import { deviceNoun } from '@renderer/lib/device'
import { modelKindLabel } from '@renderer/lib/model-kind-labels'
import {
  filterAndSort,
  parseParamCount,
  CREDIBILITY_OPTIONS,
  SIZE_OPTIONS,
  SORT_OPTIONS,
  determineCredibility,
  hasActiveFilters,
  initialFilterState,
  recommendedImageModelId,
  type FilterState,
  type Credibility
} from '@offgrid/models'

function Sel({
  value,
  onChange,
  options,
  allLabel,
  prefix
}: {
  value: string
  onChange: (v: string) => void
  options: readonly { key: string; label: string }[]
  allLabel?: string
  prefix?: string
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])
  const items = allLabel ? [{ key: 'all', label: allLabel }, ...options] : [...options]
  const current = items.find((o) => o.key === value) ?? items[0]
  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className={`flex items-center gap-1 rounded border bg-neutral-900/60 px-2 py-1 text-[10px] transition-colors ${open ? 'border-green-500 text-white' : 'border-neutral-800 text-neutral-400 hover:border-neutral-600 hover:text-white'}`}
      >
        <span>
          {prefix ?? ''}
          {current?.label}
        </span>
        <IconChevronDown
          className={`h-2.5 w-2.5 text-neutral-500 transition-transform duration-150 ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open && (
        <div className="absolute left-0 z-30 mt-1 min-w-[150px] overflow-hidden rounded border border-neutral-800 bg-neutral-950 py-0.5 shadow-xl">
          {items.map((o) => (
            <button
              key={o.key}
              onClick={() => {
                onChange(o.key)
                setOpen(false)
              }}
              className={`flex w-full items-center gap-1.5 px-2.5 py-1 text-left text-[10px] transition-colors hover:bg-neutral-900 ${o.key === value ? 'text-green-500' : 'text-neutral-300'}`}
            >
              <IconCheck
                className={`h-2.5 w-2.5 shrink-0 transition-opacity ${o.key === value ? 'opacity-100' : 'opacity-0'}`}
              />
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

interface ModelFile {
  name: string
  url: string
  sizeBytes?: number
}
interface ModelEntry {
  id: string
  name: string
  kind: string
  org?: string
  description?: string
  params?: number
  minRamGb?: number
  isNew?: boolean
  files: ModelFile[]
  imageModes?: string[]
  tags?: string[]
  releaseDate?: string
  quant?: string
}

interface UseCase {
  id: string
  label: string
  blurb: string
  match: (m: { params?: number; kind?: string }) => boolean
}
const USE_CASES: UseCase[] = [
  { id: 'all', label: 'All', blurb: '', match: () => true },
  {
    id: 'general',
    label: 'General',
    blurb: 'Everyday questions, drafting, and brainstorming.',
    match: () => true
  },
  {
    id: 'coding',
    label: 'Coding',
    blurb: 'Code generation — larger models reason better.',
    match: (m) => (m.params ?? 0) >= 4
  },
  {
    id: 'writing',
    label: 'Writing',
    blurb: 'Long-form drafting — long context helps.',
    match: (m) => (m.params ?? 0) >= 2
  },
  {
    id: 'legal',
    label: 'Legal',
    blurb: `Dense docs, careful reasoning — on-device, nothing leaves your ${deviceNoun()}.`,
    match: (m) => (m.params ?? 0) >= 7
  },
  {
    id: 'vision',
    label: 'Vision',
    blurb: 'Understand images, screenshots, documents.',
    match: (m) => m.kind === 'vision'
  },
  {
    id: 'lightweight',
    label: 'Lightweight',
    blurb: 'Fast, low-memory — for modest machines.',
    match: (m) => (m.params ?? 0) <= 4
  }
]

function fmtReleaseDate(iso?: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
}

function featureRank(
  m: { id?: string; credibility?: string; tags?: string[] },
  recommendedId?: string | null
): number {
  // The model recommended for THIS machine's RAM sorts to the very top (above a
  // plain 'Fast' pick). Then distilled few-step models (tagged "Fast") render in
  // ~30s vs ~100s, so surface them next. Then our own org's models, then the rest.
  if (recommendedId && m.id === recommendedId) return -1
  if (m.tags?.some((t) => /^fast/i.test(t))) return 0
  if (m.credibility !== 'offgrid') return 2
  return 1
}

const MODE_LABELS: Record<string, string> = { txt2img: 'Text→Image', img2img: 'Image→Image' }

function withoutProgressEntry(
  progress: Record<string, { percent: number; status?: string }>,
  modelId: string
): Record<string, { percent: number; status?: string }> {
  const next = { ...progress }
  delete next[modelId]
  return next
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const api = (window as any).api

export function ModelsScreen(): React.JSX.Element {
  const [kinds, setKinds] = useState<string[]>([])
  const [models, setModels] = useState<ModelEntry[]>([])
  const [installed, setInstalled] = useState<string[]>([])
  const [activeKind, setActiveKind] = useState<string>('text')
  const [progress, setProgress] = useState<Record<string, { percent: number; status?: string }>>({})
  // Active model ids across ALL modalities (chat + image/voice/transcription) —
  // one truth from the backend; the UI never re-derives "active" per kind.
  const [activeIds, setActiveIds] = useState<Set<string>>(new Set())
  const isActive = (id: string): boolean => activeIds.has(id)
  const refreshActive = (): void => {
    void api.getActiveModelIds?.().then((ids: string[]) => setActiveIds(new Set(ids)))
  }
  const [switching, setSwitching] = useState<string | null>(null)
  const [switchError, setSwitchError] = useState<string | null>(null)
  const [ramGb, setRamGb] = useState<number | null>(null)
  const [importing, setImporting] = useState(false)
  const [useCase, setUseCase] = useState('all')
  const [detail, setDetail] = useState<ModelEntry | null>(null)
  const [detailVisible, setDetailVisible] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [hfResults, setHfResults] = useState<
    {
      id: string
      name: string
      org: string
      downloads?: number
      likes?: number
      lastModified?: string
      credibility?: string
    }[]
  >([])
  const [searching, setSearching] = useState(false)
  const [filterState, setFilterState] = useState<FilterState>(initialFilterState)
  const [sizeBucket, setSizeBucket] = useState<number | null>(null)
  const SIZE_BUCKETS = [2, 4, 6, 8, 16] as const

  const openDetail = useCallback((m: ModelEntry) => {
    setDetail(m)
    requestAnimationFrame(() => requestAnimationFrame(() => setDetailVisible(true)))
  }, [])

  const closeDetail = useCallback(() => {
    setDetailVisible(false)
    setTimeout(() => setDetail(null), 220)
  }, [])

  useEffect(() => {
    if (!detail) return undefined
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') closeDetail()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [closeDetail, detail])

  const importModel = async (): Promise<void> => {
    if (importing) return
    setImporting(true)
    try {
      const res = await api.importLocalModel?.()
      if (res?.success) {
        const c = await api.getModelCatalog?.()
        if (c) {
          setKinds(c.kinds)
          setModels(c.models)
        }
        setInstalled(await api.getInstalledModels?.())
        setActiveKind('text')
      } else if (res && !res.canceled && res.error) {
        window.alert(`Import failed: ${res.error}`)
      }
    } finally {
      setImporting(false)
    }
  }

  useEffect(() => {
    api
      .systemHealth?.()
      .then((h: { ramGb?: number }) => setRamGb(h.ramGb ?? null))
      .catch(() => {})
    api.getModelCatalog?.().then((c: { kinds: string[]; models: ModelEntry[] }) => {
      setKinds(c.kinds)
      setModels(c.models)
      if (c.kinds[0]) setActiveKind(c.kinds[0])
    })
    api.getInstalledModels?.().then(setInstalled)
    refreshActive()
    const off = api.onModelProgress?.(
      (d: { modelId: string; percent?: number; status?: string }) => {
        if (d.status === 'cancelled') {
          setProgress((p) => withoutProgressEntry(p, d.modelId))
          return
        }
        setProgress((p) => ({
          ...p,
          [d.modelId]: { percent: d.percent ?? p[d.modelId]?.percent ?? 0, status: d.status }
        }))
        if (d.status === 'completed') api.getInstalledModels?.().then(setInstalled)
      }
    )
    return off
  }, [])

  const cancelDownload = (id: string): void => {
    void api.cancelModelDownload?.(id)
    setProgress((p) => withoutProgressEntry(p, id))
  }
  const download = (id: string): void => {
    setProgress((p) => ({ ...p, [id]: { percent: 0, status: 'downloading' } }))
    api.downloadModel?.(id)
  }
  const removeModel = async (id: string, label: string): Promise<void> => {
    if (!window.confirm(`Delete "${label}"? This removes its files from disk.`)) return
    setDeleting(id)
    try {
      await api.deleteModel?.(id)
      setInstalled(await api.getInstalledModels?.())
      refreshActive()
    } finally {
      setDeleting(null)
    }
  }
  const activateModel = async (id: string): Promise<void> => {
    if (switching) return
    try {
      const fit = await api.estimateModelFit?.(id)
      if (fit && fit.level !== 'ok') {
        if (!window.confirm(`${fit.message}\n\nLoad it anyway?`)) return
      }
    } catch {
      /* best-effort */
    }
    setSwitchError(null)
    setSwitching(id)
    try {
      // Single activation seam — main process routes by kind (chat LLM vs modal default).
      const res = await api.activateModel?.(id)
      if (res?.success) refreshActive()
      else setSwitchError(res?.error ? `Couldn't switch: ${res.error}` : "Couldn't switch model")
    } catch (e) {
      setSwitchError(e instanceof Error ? e.message : "Couldn't switch model")
    } finally {
      setSwitching(null)
    }
  }

  const searchEnabled = activeKind !== 'voice' && activeKind !== 'transcription'
  const searchingMode = searchEnabled && query.trim().length >= 2
  const totalBytes = (m: { files?: { sizeBytes?: number }[] }): number =>
    (m.files || []).reduce((s, f) => s + (f.sizeBytes || 0), 0)

  useEffect(() => {
    const q = query.trim()
    if (!searchEnabled || q.length < 2) {
      setHfResults([])
      return
    }
    setSearching(true)
    const t = setTimeout(async () => {
      const res = await api.searchModels?.(q, activeKind)
      setHfResults(res ?? [])
      setSearching(false)
    }, 400)
    return () => clearTimeout(t)
  }, [query, activeKind, searchEnabled])

  const list = models.filter(
    (m) => m.kind === activeKind || (activeKind === 'text' && m.kind === 'vision')
  )

  // The image model recommended for this machine's RAM (Light Q4 on <=16GB, full
  // Q8 above) — one pure rule, reused for both the badge and the top-of-list sort.
  const recommendedImageId = recommendedImageModelId(models, ramGb)

  const displayed = filterAndSort(
    hfResults.map((r) => ({
      id: r.id,
      name: r.name,
      org: r.org,
      downloads: r.downloads,
      likes: r.likes,
      lastModified: r.lastModified,
      credibility: r.credibility as Credibility | undefined,
      params: parseParamCount(r.name) ?? parseParamCount(r.id)
    })),
    filterState
  )

  const displayedCatalog = filterAndSort(
    list.map((m) => ({
      ...m,
      org: m.org ?? '',
      params: m.params ?? parseParamCount(m.name) ?? undefined,
      credibility: determineCredibility((m.id || '').split('/')[0]!)
    })),
    filterState
  )
    .filter((m) => sizeBucket == null || totalBytes(m) <= sizeBucket * 1e9)
    .filter(
      (m) => activeKind !== 'text' || (USE_CASES.find((u) => u.id === useCase)?.match(m) ?? true)
    )
    .sort((a, b) => {
      // Active first, then other installed, then available — within each tier keep feature rank.
      const rank = (x: { id: string }): number =>
        isActive(x.id) ? 0 : installed.includes(x.id) ? 1 : 2
      return (
        rank(a) - rank(b) || featureRank(a, recommendedImageId) - featureRank(b, recommendedImageId)
      )
    })

  const tabs = [...kinds.filter((k) => k !== 'vision'), 'storage']

  // Live download summary for the Storage tab label. The manager owns queued vs
  // transferring; this surface only counts its emitted statuses.
  const storageCounts = {
    downloading: Object.values(progress).filter((p) => p.status === 'downloading').length,
    queued: Object.values(progress).filter((p) => p.status === 'queued').length,
    failed: Object.values(progress).filter((p) => p.status === 'failed').length
  }

  // RAM fit label for a model
  const ramFit = (m: { files?: ModelFile[] }): 'ok' | 'tight' | 'risky' => {
    if (!ramGb) return 'ok'
    const gb = totalBytes(m) / 1e9
    if (!gb) return 'ok'
    return gb <= ramGb * 0.38 ? 'ok' : gb <= ramGb * 0.55 ? 'tight' : 'risky'
  }

  const renderCard = (
    m: ModelEntry & { credibility?: string; params?: number; org?: string },
    isHf = false
  ): React.JSX.Element => {
    const isInstalled = installed.includes(m.id)
    const active = isActive(m.id)
    const prog = progress[m.id]
    const downloading = prog && prog.status !== 'completed' && prog.status !== 'failed'
    const bytes = totalBytes(m)
    const size = bytes > 0 ? `${(bytes / 1e9).toFixed(1)}GB` : null
    const meta = [m.org, m.params ? `${m.params}B` : null, size, fmtReleaseDate(m.releaseDate)]
      .filter(Boolean)
      .join(' · ')
    const fit = isHf ? 'ok' : ramFit(m)
    const tags = (m.tags ?? []).filter((t) => !/tight|risky|fit/i.test(t))
    // The single image pick best-suited to THIS machine's RAM (Light on <=16GB,
    // full above) — a prominent filled-emerald badge, distinct from the outlined tags.
    const recommended = !isHf && !!recommendedImageId && m.id === recommendedImageId

    return (
      <div
        key={m.id}
        role="listitem"
        className={`group flex flex-col gap-2 rounded-md border p-3 transition-all duration-150 hover:border-neutral-700 ${active ? 'border-green-500/50 bg-green-500/5' : 'border-neutral-800 bg-neutral-900/40'}`}
      >
        {/* Title row */}
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1">
              <button
                onClick={() => openDetail(m)}
                className="truncate text-left text-xs text-neutral-100 transition-colors duration-100 hover:text-green-400"
              >
                {m.name}
              </button>
              {m.kind === 'vision' && (
                <span className="flex shrink-0 items-center gap-0.5 rounded-sm border border-green-500/60 px-1 py-px text-[8px] uppercase tracking-wide text-green-500">
                  <IconEye className="h-2 w-2" /> Vision
                </span>
              )}
              {m.isNew && (
                <span className="shrink-0 rounded-sm border border-green-500/60 px-1 py-px text-[8px] uppercase tracking-wide text-green-500">
                  New
                </span>
              )}
            </div>
            {meta && <div className="mt-0.5 truncate text-[10px] text-neutral-600">{meta}</div>}
          </div>
          <button
            onClick={() => openDetail(m)}
            title="Details"
            className="shrink-0 rounded p-0.5 text-neutral-700 opacity-0 transition-all duration-150 hover:text-neutral-300 active:scale-90 group-hover:opacity-100"
          >
            <IconInfoCircle className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Badges row */}
        {(recommended || tags.length > 0 || fit !== 'ok') && (
          <div className="flex flex-wrap items-center gap-1">
            {recommended && (
              // Prominent FILLED emerald badge — the pick for this machine's RAM,
              // set apart from the outlined capability tags below.
              <span className="flex shrink-0 items-center gap-0.5 rounded-sm bg-green-500 px-1.5 py-px text-[8px] font-semibold uppercase tracking-wide text-black">
                <IconStarFilled className="h-2 w-2" /> Recommended for you
              </span>
            )}
            {tags.map((t) => {
              // "Fast" = distilled few-step model (~30s vs ~100s) — highlight in
              // the emerald brand accent so it reads as the recommended quick pick.
              // "Light" = a smaller/lower-memory quant — amber outline so it reads
              // as the memory-friendly variant (distinct from the emerald "Fast").
              const isFast = /^fast/i.test(t)
              const isLight = /^light$/i.test(t)
              const cls = isFast
                ? 'border border-green-500/60 text-green-500'
                : isLight
                  ? 'border border-emerald-300/50 text-emerald-300'
                  : /challenger/i.test(t)
                    ? 'text-amber-400'
                    : 'bg-neutral-800 text-neutral-500'
              return (
                <span
                  key={t}
                  className={`rounded-sm px-1 py-px text-[8px] uppercase tracking-wide ${cls}`}
                >
                  {t}
                </span>
              )
            })}
            {fit !== 'ok' && (
              <span
                className={`rounded-sm px-1.5 py-px text-[8px] uppercase tracking-wide ${fit === 'tight' ? 'border border-amber-400/60 text-amber-400' : 'border border-amber-400/60 bg-amber-400/10 text-amber-400'}`}
              >
                {fit === 'tight' ? 'Tight on RAM' : 'May not fit'}
              </span>
            )}
          </div>
        )}

        {/* Action row */}
        <div className="mt-auto flex items-center justify-between gap-2 pt-1">
          {active ? (
            <span className="flex items-center gap-1 text-[11px] text-green-500">
              <IconCircleCheck className="h-3.5 w-3.5" /> Active
            </span>
          ) : isInstalled ? (
            // Every installed model is activatable for its type — no kind branch.
            // Includes a downloaded HF model (registered as installed), so its search
            // card flips from Download to Use instead of resetting.
            <button
              onClick={() => activateModel(m.id)}
              disabled={!!switching}
              className="flex items-center gap-1 rounded border border-neutral-700 px-2.5 py-1 text-[10px] text-neutral-300 transition-all duration-150 hover:border-green-500 hover:text-green-400 active:scale-95 disabled:opacity-40"
            >
              {switching === m.id ? (
                <>
                  <IconLoader2 className="h-3 w-3 animate-spin" /> Switching
                </>
              ) : (
                'Use'
              )}
            </button>
          ) : downloading ? (
            <button
              onClick={() => cancelDownload(m.id)}
              className="group/dl flex items-center gap-1 rounded border border-neutral-700 px-2.5 py-1 text-[10px] text-neutral-400 transition-all duration-150 hover:border-red-500/60 hover:text-red-400 active:scale-95"
            >
              {prog.status === 'queued' ? (
                <IconClock className="h-3 w-3 group-hover/dl:hidden" />
              ) : (
                <IconLoader2 className="h-3 w-3 animate-spin group-hover/dl:hidden" />
              )}
              <IconX className="hidden h-3 w-3 group-hover/dl:block" />
              <span className="group-hover/dl:hidden">
                {prog.status === 'queued' ? 'Queued' : `${prog.percent}%`}
              </span>
              <span className="hidden group-hover/dl:inline">Cancel</span>
            </button>
          ) : (
            <button
              onClick={() => download(m.id)}
              className="flex items-center gap-1 rounded border border-neutral-700 px-2.5 py-1 text-[10px] text-neutral-300 transition-all duration-150 hover:border-green-500 hover:text-green-400 active:scale-95"
            >
              <IconDownload className="h-3 w-3" /> Download
            </button>
          )}
          {isInstalled && (
            <button
              onClick={() => removeModel(m.id, m.name)}
              disabled={deleting === m.id || active}
              title={active ? 'Switch to another model before deleting' : 'Delete from disk'}
              className="rounded p-1 text-neutral-700 transition-all duration-150 hover:text-red-400 active:scale-90 disabled:opacity-30 group-hover:text-neutral-500"
            >
              {deleting === m.id ? (
                <IconLoader2 className="h-3 w-3 animate-spin" />
              ) : (
                <IconTrash className="h-3 w-3" />
              )}
            </button>
          )}
        </div>

        {/* Download progress */}
        {downloading && (
          <div className="h-0.5 w-full overflow-hidden rounded-full bg-neutral-800">
            <div
              className="h-full bg-green-500 transition-all"
              style={{ width: `${prog.percent}%` }}
            />
          </div>
        )}
      </div>
    )
  }

  const GRID = 'grid grid-cols-2 gap-2 px-6 py-3 lg:grid-cols-3 2xl:grid-cols-4'

  return (
    <div className="flex h-full flex-col font-mono">
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between border-b border-neutral-800 px-6 py-3">
        <h1 className="text-xs font-medium uppercase tracking-widest text-neutral-400">Models</h1>
        <div className="flex items-center gap-3">
          <button
            onClick={importModel}
            disabled={importing}
            className="flex items-center gap-1.5 rounded border border-neutral-700 px-2.5 py-1 text-[10px] text-neutral-400 transition-all duration-150 hover:border-green-500/60 hover:text-green-400 active:scale-95 disabled:opacity-50"
          >
            {importing ? (
              <IconLoader2 className="h-3 w-3 animate-spin" />
            ) : (
              <IconUpload className="h-3 w-3" />
            )}
            {importing ? 'Importing…' : 'Import .gguf'}
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex shrink-0 items-end gap-0 border-b border-neutral-800 px-6">
        {tabs.map((k) => (
          <button
            key={k}
            onClick={() => setActiveKind(k)}
            className={`flex items-center gap-1.5 px-3 py-2 text-[10px] uppercase tracking-wider transition-colors duration-150 ${activeKind === k ? 'border-b-2 border-green-500 text-white' : 'text-neutral-500 hover:text-neutral-300'}`}
          >
            {k === 'storage' ? (
              <>
                <IconDatabase className="h-3 w-3" /> Storage
                {/* Live counts: installed, transferring, queued, and failed. */}
                <span className="ml-1 font-normal normal-case tracking-normal text-neutral-600">
                  {installed.length}
                </span>
                {storageCounts.downloading > 0 && (
                  <span className="rounded-sm bg-green-500/15 px-1 text-[8px] text-green-500">
                    {storageCounts.downloading}↓
                  </span>
                )}
                {storageCounts.queued > 0 && (
                  <span className="rounded-sm bg-neutral-800 px-1 text-[8px] text-neutral-400">
                    {storageCounts.queued} queued
                  </span>
                )}
                {storageCounts.failed > 0 && (
                  <span className="rounded-sm bg-red-500/15 px-1 text-[8px] text-red-400">
                    {storageCounts.failed}✕
                  </span>
                )}
              </>
            ) : (
              modelKindLabel(k)
            )}
          </button>
        ))}
        {ramGb && activeKind !== 'storage' && (
          <span className="ml-auto pb-2 text-[9px] text-neutral-700">
            {ramGb}GB RAM · fits ≤{Math.round(ramGb * 0.38)}GB
          </span>
        )}
      </div>

      {/* Storage tab */}
      {activeKind === 'storage' && (
        <div className="flex-1 overflow-y-auto px-6 py-4">
          <StoragePanel />
        </div>
      )}

      {/* Catalog tab */}
      {activeKind !== 'storage' && (
        <div className="flex min-h-0 flex-1 flex-col">
          {/* Filter bar */}
          <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-neutral-800/60 px-6 py-2">
            {searchEnabled && (
              <div className="flex items-center gap-1.5 rounded border border-neutral-800 bg-neutral-900/60 px-2 py-1 focus-within:border-neutral-600">
                <IconSearch className="h-3 w-3 shrink-0 text-neutral-600" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={`Search HuggingFace…`}
                  className="w-44 bg-transparent text-[10px] text-white placeholder-neutral-600 outline-none"
                />
                {searching && <IconLoader2 className="h-3 w-3 animate-spin text-neutral-600" />}
              </div>
            )}
            <Sel
              value={filterState.source}
              onChange={(v) =>
                setFilterState((s) => ({ ...s, source: v as FilterState['source'] }))
              }
              allLabel="All sources"
              options={CREDIBILITY_OPTIONS}
            />
            <Sel
              value={filterState.size}
              onChange={(v) => setFilterState((s) => ({ ...s, size: v as FilterState['size'] }))}
              allLabel="Any size"
              options={SIZE_OPTIONS}
            />
            <Sel
              value={filterState.sort}
              onChange={(v) => setFilterState((s) => ({ ...s, sort: v as FilterState['sort'] }))}
              options={SORT_OPTIONS}
              prefix="Sort: "
            />
            {!searchingMode &&
              (SIZE_BUCKETS as readonly number[]).map((b) => (
                <button
                  key={b}
                  onClick={() => setSizeBucket((c) => (c === b ? null : b))}
                  className={`rounded border px-2 py-0.5 text-[9px] transition-all duration-150 active:scale-95 ${sizeBucket === b ? 'border-green-500 bg-green-500/10 text-green-500' : 'border-neutral-800 text-neutral-500 hover:border-neutral-600 hover:text-neutral-300'}`}
                >
                  ≤{b}GB
                </button>
              ))}
            {hasActiveFilters(filterState) && (
              <button
                onClick={() => {
                  setFilterState(initialFilterState)
                  setSizeBucket(null)
                }}
                className="rounded border border-neutral-800 px-2 py-0.5 text-[9px] text-neutral-500 transition-all duration-150 hover:border-green-500/60 hover:text-green-400 active:scale-95"
              >
                Clear
              </button>
            )}
            <span className="ml-auto text-[9px] text-neutral-700">
              {searchingMode ? displayed.length : displayedCatalog.length} models
            </span>
          </div>

          {/* Use-case chips (text only, browse mode) */}
          {activeKind === 'text' && !searchingMode && (
            <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-neutral-800/40 px-6 py-1.5">
              {USE_CASES.filter((u) => u.id !== 'all').map((u) => (
                <button
                  key={u.id}
                  onClick={() => setUseCase((cur) => (cur === u.id ? 'all' : u.id))}
                  className={`rounded-full border px-2 py-0.5 text-[9px] transition-all duration-150 active:scale-95 ${useCase === u.id ? 'border-green-500 text-green-500' : 'border-neutral-800 text-neutral-600 hover:border-neutral-700 hover:text-neutral-400'}`}
                >
                  {u.label}
                </button>
              ))}
              {useCase !== 'all' && (
                <span className="ml-2 text-[9px] text-neutral-600">
                  {USE_CASES.find((u) => u.id === useCase)?.blurb}
                </span>
              )}
            </div>
          )}

          {switchError && (
            <div className="shrink-0 border-b border-red-500/20 bg-red-500/10 px-6 py-1.5 text-[10px] text-red-300">
              {switchError}
            </div>
          )}

          {/* Model grid */}
          <div className="flex-1 overflow-y-auto">
            {searchingMode ? (
              <>
                {displayed.length === 0 && !searching && (
                  <p className="px-6 py-4 text-xs text-neutral-600">
                    No results for &quot;{query}&quot;.
                  </p>
                )}
                <div role="list" aria-label="Model search results" className={GRID}>
                  {displayed.map((r) =>
                    renderCard(
                      {
                        id: r.id,
                        name: r.name,
                        kind: activeKind,
                        org: r.org,
                        files: [],
                        params: r.params ?? undefined,
                        credibility: r.credibility
                      },
                      true
                    )
                  )}
                </div>
              </>
            ) : (
              (() => {
                if (displayedCatalog.length === 0) {
                  return (
                    <p className="px-6 py-4 text-xs text-neutral-600">
                      No models match the current filters.
                    </p>
                  )
                }
                const installedModels = displayedCatalog.filter((m) => installed.includes(m.id))
                const availableModels = displayedCatalog.filter((m) => !installed.includes(m.id))
                return (
                  <>
                    {installedModels.length > 0 && (
                      <>
                        <div className="px-6 pt-3 text-[9px] uppercase tracking-widest text-neutral-600">
                          On this device
                        </div>
                        <div role="list" aria-label="Models on this device" className={GRID}>
                          {installedModels.map((m) => renderCard(m))}
                        </div>
                      </>
                    )}
                    {availableModels.length > 0 && (
                      <>
                        <div className="px-6 pt-2 text-[9px] uppercase tracking-widest text-neutral-600">
                          Available to download
                        </div>
                        <div role="list" aria-label="Models available to download" className={GRID}>
                          {availableModels.map((m) => renderCard(m))}
                        </div>
                      </>
                    )}
                  </>
                )
              })()
            )}
          </div>
        </div>
      )}

      {/* Detail slide-over */}
      {detail &&
        (() => {
          const m = detail
          const isLocal = m.id.startsWith('local:')
          const hfUrl = !isLocal && m.id.includes('/') ? `https://huggingface.co/${m.id}` : null
          const bytes = totalBytes(m)
          const isInstalled = installed.includes(m.id)
          const active = isActive(m.id)
          const prog = progress[m.id]
          const downloading = prog && prog.status !== 'completed' && prog.status !== 'failed'
          const rows: [string, string | null][] = [
            ['Source', m.org || (isLocal ? 'Imported' : '—')],
            ['Parameters', m.params ? `${m.params}B` : null],
            ['Quantization', m.quant || null],
            ['Download', bytes > 0 ? `${(bytes / 1e9).toFixed(1)} GB` : null],
            ['Released', fmtReleaseDate(m.releaseDate) || null],
            ['Min RAM', m.minRamGb ? `${m.minRamGb} GB` : null]
          ]
          return (
            <div className="fixed inset-0 z-50 flex justify-end">
              <div
                onClick={closeDetail}
                className={`absolute inset-0 bg-black/50 transition-opacity duration-200 ${detailVisible ? 'opacity-100' : 'opacity-0'}`}
              />
              <div
                className={`relative z-10 flex h-full w-[26vw] min-w-[380px] flex-col border-l border-neutral-800 bg-neutral-950 font-mono shadow-2xl transition-transform duration-200 ease-out ${detailVisible ? 'translate-x-0' : 'translate-x-full'}`}
              >
                <div className="flex items-start justify-between gap-3 border-b border-neutral-800 px-5 py-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h2 className="truncate text-sm text-white">{m.name}</h2>
                      {m.kind === 'vision' && (
                        <span className="flex items-center gap-0.5 rounded-sm border border-green-500/60 px-1 py-px text-[8px] uppercase tracking-wide text-green-500">
                          <IconEye className="h-2.5 w-2.5" /> Vision
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 truncate text-[10px] text-neutral-600">{m.id}</div>
                  </div>
                  <button
                    onClick={closeDetail}
                    className="rounded border border-neutral-800 px-2.5 py-1 text-[10px] text-neutral-400 transition-all duration-150 hover:border-neutral-600 hover:text-white active:scale-95"
                  >
                    Close
                  </button>
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
                  {m.description && (
                    <p className="text-xs leading-relaxed text-neutral-300">{m.description}</p>
                  )}
                  <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2">
                    {rows
                      .filter(([, v]) => v)
                      .map(([k, v]) => (
                        <div key={k}>
                          <dt className="text-[9px] uppercase tracking-wide text-neutral-600">
                            {k}
                          </dt>
                          <dd className="text-xs text-neutral-200">{v}</dd>
                        </div>
                      ))}
                  </dl>
                  {ramGb && bytes > 0 && (
                    <p className="mt-4 text-[10px] text-neutral-500">
                      {bytes / 1e9 <= ramGb * 0.38
                        ? `Comfortable fit on your ${deviceNoun()}.`
                        : bytes / 1e9 <= ramGb * 0.55
                          ? 'Tight on RAM — context will be reduced.'
                          : `Large for your ${deviceNoun()} — may run slowly.`}
                    </p>
                  )}
                  {m.imageModes && m.imageModes.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-1">
                      {m.imageModes.map((mode) => (
                        <span
                          key={mode}
                          className="rounded-sm border border-green-500/40 px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-green-500"
                        >
                          {MODE_LABELS[mode] ?? mode}
                        </span>
                      ))}
                    </div>
                  )}
                  {hfUrl && (
                    <button
                      onClick={() =>
                        (
                          window as { api?: { openExternal?: (u: string) => void } }
                        ).api?.openExternal?.(hfUrl)
                      }
                      className="mt-4 flex items-center gap-1 text-[10px] text-green-500 transition-colors duration-150 hover:text-green-400"
                    >
                      <IconExternalLink className="h-3 w-3" /> View on Hugging Face
                    </button>
                  )}
                </div>

                <div className="flex items-center gap-2 border-t border-neutral-800 px-5 py-3">
                  {active ? (
                    <span className="flex items-center gap-1 text-xs text-green-500">
                      <IconCircleCheck className="h-4 w-4" /> Active
                    </span>
                  ) : isInstalled ? (
                    <>
                      <button
                        onClick={() => {
                          void activateModel(m.id)
                          closeDetail()
                        }}
                        disabled={!!switching}
                        className="rounded border border-neutral-700 px-3 py-1.5 text-xs text-white transition-all duration-150 hover:border-green-500 hover:text-green-400 active:scale-95 disabled:opacity-50"
                      >
                        Use this model
                      </button>
                      <button
                        onClick={() => {
                          void removeModel(m.id, m.name)
                          closeDetail()
                        }}
                        className="rounded border border-neutral-800 px-3 py-1.5 text-xs text-neutral-500 transition-all duration-150 hover:border-red-500/60 hover:text-red-400 active:scale-95"
                      >
                        Delete
                      </button>
                    </>
                  ) : downloading ? (
                    <span className="text-xs text-neutral-400">
                      {prog.status === 'queued' ? 'Queued' : `Downloading ${prog.percent}%…`}
                    </span>
                  ) : (
                    <button
                      onClick={() => {
                        download(m.id)
                        closeDetail()
                      }}
                      className="flex items-center gap-1 rounded border border-neutral-700 px-3 py-1.5 text-xs text-white transition-all duration-150 hover:border-green-500 hover:text-green-400 active:scale-95"
                    >
                      <IconDownload className="h-3.5 w-3.5" /> Download
                    </button>
                  )}
                </div>
              </div>
            </div>
          )
        })()}
    </div>
  )
}
