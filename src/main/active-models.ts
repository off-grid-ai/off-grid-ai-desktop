// Per-modality active-model selection. The text/vision chat LLM is switched via
// active-model.json (it reloads llama-server); the other modalities — image,
// speech (TTS), transcription (STT) — are stateless per-call runtimes, so we just
// record the chosen model id here and each runtime reads it (falling back to its
// own heuristic when nothing is chosen). One file: active-modalities.json.
import fs from 'fs'
import path from 'path'
import { modelsDir } from './runtime-env'

export type Modality = 'image' | 'speech' | 'transcription'

/**
 * The single source of truth mapping a catalog model `kind` to its modality.
 * 'text'/'vision' are the chat LLM (no modality — they load llama-server, not a
 * stateless per-call runtime), so they return null. Everything that activates a
 * model routes through this — never re-derive the mapping in a caller/UI.
 */
export function modalityForKind(kind?: string | null): Modality | null {
  switch (kind) {
    case 'image':
      return 'image'
    case 'voice':
    case 'speech':
      return 'speech' // accept the setup vocab ('voice') AND the storage vocab ('speech')
    case 'transcription':
      return 'transcription'
    default:
      return null // text / vision / local / unknown -> chat LLM, not a modality
  }
}

/**
 * Whether a given installed model is the active one for its type. Pure — the one
 * rule the Storage UI and getStorageInfo both rely on:
 *   - image/voice/transcription: matches that modality's chosen value, which is
 *     stored as either the catalog id OR the primary filename → match either;
 *   - text/vision/local/imported (no modality): the active chat LLM id.
 */
export function isModelActive(opts: {
  kind?: string | null
  id: string
  primaryFile?: string | null
  activeChatId: string | null
  modals: Record<Modality, string | null>
}): boolean {
  const modal = modalityForKind(opts.kind)
  if (modal) {
    const chosen = opts.modals[modal]
    return chosen != null && (chosen === opts.id || chosen === opts.primaryFile)
  }
  return opts.id === opts.activeChatId
}

function storeFile(): string {
  return path.join(modelsDir(), 'active-modalities.json')
}

function readAll(): Record<string, string | null> {
  try {
    return JSON.parse(fs.readFileSync(storeFile(), 'utf-8'))
  } catch {
    return {}
  }
}

/** The chosen model id for a modality, or null to use the runtime's default. */
export function getActiveModal(kind: Modality): string | null {
  return readAll()[kind] ?? null
}

export function setActiveModal(kind: Modality, id: string | null): void {
  const cur = readAll()
  cur[kind] = id
  try {
    fs.mkdirSync(path.dirname(storeFile()), { recursive: true })
    fs.writeFileSync(storeFile(), JSON.stringify(cur, null, 2))
  } catch (e) {
    console.error('[active-models] write failed', e)
  }
}

export function getAllActiveModals(): Record<Modality, string | null> {
  const all = readAll()
  return {
    image: all.image ?? null,
    speech: all.speech ?? null,
    transcription: all.transcription ?? null
  }
}
