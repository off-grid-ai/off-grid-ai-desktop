import { useCallback, useEffect, useState } from 'react'
import {
  IconLoader2,
  IconCheck,
  IconCpu,
  IconX,
  IconPower,
  IconArrowLeft
} from '@tabler/icons-react'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const api = (): any => (window as any).api

interface ModelFile {
  name: string
  role?: string
}
interface ModelEntry {
  id: string
  name: string
  kind: string
  files?: ModelFile[]
}

// The text/vision LLM is selected by catalog id (it reloads llama-server); image
// and transcription runtimes resolve by FILENAME on disk; voice is one engine.
const MODALITIES: {
  label: string
  kinds: string[]
  mode: 'text' | 'image' | 'speech' | 'transcription'
}[] = [
  { label: 'Text & Vision', kinds: ['text', 'vision'], mode: 'text' },
  { label: 'Image', kinds: ['image'], mode: 'image' },
  { label: 'Voice', kinds: ['voice'], mode: 'speech' },
  { label: 'Transcription', kinds: ['transcription'], mode: 'transcription' }
]
type PickerMode = (typeof MODALITIES)[number]['mode']

// Picker mode -> runtime Modality (the id the unload/residency seam uses). One map,
// so the composer chip / panel / any future surface all resolve unload the same way.
const MODE_TO_MODALITY: Record<PickerMode, string> = {
  text: 'llm',
  image: 'image',
  speech: 'tts',
  transcription: 'stt'
}

function primaryFile(m: ModelEntry): string {
  return m.files?.find((f) => f.role === 'primary')?.name ?? m.files?.[0]?.name ?? m.id
}

export function ModelPicker({ onClose }: { onClose: () => void }): React.ReactElement {
  const [models, setModels] = useState<ModelEntry[]>([])
  const [installed, setInstalled] = useState<string[]>([])
  // The active selection per modality: id for text, filename for image/STT.
  const [active, setActive] = useState<Record<string, string | null>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [unloading, setUnloading] = useState<string | null>(null)
  const [unloaded, setUnloaded] = useState<string | null>(null)
  const [unloadError, setUnloadError] = useState<string | null>(null)
  // L2 detail: a model card was opened. Null = the grid of all modalities.
  const [detail, setDetail] = useState<{ mode: PickerMode; model: ModelEntry } | null>(null)

  const load = useCallback(async () => {
    const cat = await api().getModelCatalog?.()
    setModels(cat?.models ?? [])
    setInstalled((await api().getInstalledModels?.()) ?? [])
    const text = await api().getActiveModel?.()
    const modal = (await api().getActiveModalities?.()) ?? {}
    setActive({
      text: text ?? modal.text ?? null,
      image: modal.image ?? null,
      speech: modal.speech ?? null,
      transcription: modal.transcription ?? null
    })
  }, [])
  useEffect(() => {
    void load()
  }, [load])

  const isActiveModel = (mode: PickerMode, m: ModelEntry): boolean =>
    mode === 'text' ? active[mode] === m.id : active[mode] === primaryFile(m)
  const modalityLabel = (mode: PickerMode): string =>
    MODALITIES.find((x) => x.mode === mode)?.label ?? mode

  const choose = async (mode: PickerMode, m: ModelEntry): Promise<void> => {
    setBusy(m.id)
    setUnloaded((u) => (u === mode ? null : u)) // re-selecting reloads this modality
    try {
      if (mode === 'text') {
        await api().setActiveModel?.(m.id)
        setActive((a) => ({ ...a, text: m.id }))
      } else {
        const fname = primaryFile(m)
        await api().setActiveModalModel?.(mode, fname)
        setActive((a) => ({ ...a, [mode]: fname }))
      }
    } finally {
      setBusy(null)
    }
  }

  // Unload this modality's model from memory now (frees RAM; reloads on next use).
  const unload = async (mode: PickerMode): Promise<void> => {
    if (typeof api().unloadRuntime !== 'function') {
      // Preload method missing — the app must be restarted after the preload changed.
      setUnloadError(mode)
      console.error('[models] unloadRuntime is unavailable — restart the app')
      return
    }
    setUnloading(mode)
    setUnloadError(null)
    try {
      const freed = await api().unloadRuntime(MODE_TO_MODALITY[mode])
      console.log(`[models] unload ${mode} (${MODE_TO_MODALITY[mode]}):`, freed ? 'freed' : 'nothing loaded')
      setUnloaded(mode) // persistent until re-selected
    } catch (e) {
      console.error('[models] unload failed', e)
      setUnloadError(mode)
    } finally {
      setUnloading(null)
    }
  }

  return (
    <div className="fixed right-0 top-0 bottom-0 z-50 flex w-[30vw] min-w-[420px] flex-col border-l border-neutral-800 bg-neutral-950 font-mono shadow-2xl">
      <div className="flex items-center justify-between border-b border-neutral-900 px-4 py-3">
        {detail ? (
          <button
            onClick={() => setDetail(null)}
            className="flex items-center gap-2 text-sm text-neutral-400 transition-colors hover:text-white"
          >
            <IconArrowLeft className="h-4 w-4" /> {modalityLabel(detail.mode)}
          </button>
        ) : (
          <div className="flex items-center gap-2 text-sm text-white">
            <IconCpu className="h-4 w-4 text-green-500" aria-hidden /> Active models
          </div>
        )}
        <button onClick={onClose} aria-label="Close" className="text-neutral-500 hover:text-white">
          <IconX className="h-4 w-4" />
        </button>
      </div>

      {detail ? (
        <ModelDetail
          mode={detail.mode}
          model={detail.model}
          active={isActiveModel(detail.mode, detail.model)}
          busy={busy === detail.model.id}
          unloading={unloading === detail.mode}
          unloaded={unloaded === detail.mode}
          unloadError={unloadError === detail.mode}
          onSetActive={() => void choose(detail.mode, detail.model)}
          onUnload={() => void unload(detail.mode)}
        />
      ) : (
        <div className="flex-1 space-y-5 overflow-y-auto p-4">
          {MODALITIES.map(({ label, kinds, mode }) => {
            const list = models.filter((m) => kinds.includes(m.kind) && installed.includes(m.id))
            return (
              <div key={mode}>
                <div className="mb-1.5 text-[10px] uppercase tracking-wide text-neutral-600">
                  {label}
                </div>
                {list.length === 0 ? (
                  <p className="px-1 py-1 text-xs text-neutral-600">
                    No {label.toLowerCase()} model downloaded — get one in Models.
                  </p>
                ) : (
                  <div className="grid grid-cols-2 gap-2">
                    {list.map((m) => {
                      const activeNow = isActiveModel(mode, m)
                      return (
                        <button
                          key={m.id}
                          onClick={() => setDetail({ mode, model: m })}
                          className={`flex flex-col gap-1.5 rounded-md border p-2.5 text-left text-xs transition-colors ${
                            activeNow
                              ? 'border-green-500/60 bg-neutral-900 text-white'
                              : 'border-neutral-800 text-neutral-300 hover:bg-neutral-900/60'
                          }`}
                        >
                          <span className="truncate">{m.name}</span>
                          <span className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-neutral-600">
                            {activeNow && unloaded === mode ? (
                              <>
                                <IconPower className="h-3 w-3" /> Unloaded
                              </>
                            ) : activeNow ? (
                              <>
                                <IconCheck className="h-3 w-3 text-green-500" /> Active
                              </>
                            ) : (
                              'Details'
                            )}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
          <p className="px-1 pt-1 text-[10px] leading-relaxed text-neutral-600">
            Text/Vision swaps the chat model (reloads on next message). Image &amp; Transcription
            apply on the next generation/recording. All on-device.
          </p>
        </div>
      )}
    </div>
  )
}

/** L2 detail for one model: what it is + set-active / unload. Presentational — all
 *  state and actions come from ModelPicker (one owner of the model lifecycle). */
function ModelDetail(props: {
  mode: PickerMode
  model: ModelEntry
  active: boolean
  busy: boolean
  unloading: boolean
  unloaded: boolean
  unloadError: boolean
  onSetActive: () => void
  onUnload: () => void
}): React.ReactElement {
  const { model, active, busy, unloading, unloaded, unloadError, onSetActive, onUnload } = props
  return (
    <div className="flex-1 overflow-y-auto p-4">
      <div className="mb-4">
        <div className="text-base text-white">{model.name}</div>
        <div className="mt-1 text-[10px] uppercase tracking-wide text-neutral-600">{model.kind}</div>
      </div>
      {model.files?.length ? (
        <div className="mb-4 rounded-md border border-neutral-800 bg-neutral-950 p-3">
          <div className="mb-1.5 text-[10px] uppercase tracking-wide text-neutral-600">Files</div>
          <div className="space-y-0.5">
            {model.files.map((f) => (
              <div key={f.name} className="flex justify-between gap-3 text-xs text-neutral-400">
                <span className="truncate">{f.name}</span>
                {f.role ? <span className="shrink-0 text-neutral-600">{f.role}</span> : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        {active ? (
          <span className="flex items-center gap-1.5 rounded-md border border-green-500/60 bg-neutral-900 px-3 py-2 text-xs text-green-500">
            <IconCheck className="h-4 w-4" /> Active
          </span>
        ) : (
          <button
            onClick={onSetActive}
            disabled={busy}
            className="flex items-center gap-1.5 rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-xs text-white transition-colors hover:border-green-500/60 disabled:opacity-50"
          >
            {busy ? (
              <IconLoader2 className="h-4 w-4 animate-spin" />
            ) : (
              <IconCheck className="h-4 w-4" />
            )}
            Set active
          </button>
        )}
        {active ? (
          <button
            onClick={onUnload}
            disabled={unloading || unloaded}
            title={
              unloadError
                ? 'Unload unavailable — restart the app'
                : unloaded
                  ? 'Already unloaded — reloads on next use'
                  : 'Unload from memory now — frees RAM; reloads on next use'
            }
            className={`flex items-center gap-1.5 rounded-md border border-neutral-800 px-3 py-2 text-xs transition-colors disabled:opacity-40 ${
              unloadError ? 'text-amber-400' : 'text-neutral-400 hover:text-red-400'
            }`}
          >
            {unloading ? (
              <IconLoader2 className="h-4 w-4 animate-spin" />
            ) : (
              <IconPower className="h-4 w-4" />
            )}
            {unloadError ? 'Restart to unload' : unloaded ? 'Unloaded' : 'Unload'}
          </button>
        ) : null}
      </div>
    </div>
  )
}
