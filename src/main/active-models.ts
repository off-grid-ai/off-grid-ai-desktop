// Per-modality active-model selection. The text/vision chat LLM is switched via
// active-model.json (it reloads llama-server); the other modalities — image,
// speech (TTS), transcription (STT) — are stateless per-call runtimes, so we just
// record the chosen model id here and each runtime reads it (falling back to its
// own heuristic when nothing is chosen). One file: active-modalities.json.
import fs from 'fs'
import path from 'path'
import { modelsDir } from './runtime-env'
import type { Modality } from './active-models-logic'
export { isModelActive, modalityForKind, type Modality } from './active-models-logic'

export class ActiveModalityStore {
  constructor(private readonly directory: () => string = modelsDir) {}

  private storeFile(): string {
    return path.join(this.directory(), 'active-modalities.json')
  }

  private readAll(): Record<string, string | null> {
    try {
      return JSON.parse(fs.readFileSync(this.storeFile(), 'utf-8'))
    } catch {
      return {}
    }
  }

  get(kind: Modality): string | null {
    return this.readAll()[kind] ?? null
  }

  set(kind: Modality, id: string | null): void {
    const cur = this.readAll()
    cur[kind] = id
    try {
      fs.mkdirSync(path.dirname(this.storeFile()), { recursive: true })
      fs.writeFileSync(this.storeFile(), JSON.stringify(cur, null, 2))
    } catch (error) {
      console.error('[active-models] write failed', error)
    }
  }

  all(): Record<Modality, string | null> {
    const all = this.readAll()
    return {
      image: all.image ?? null,
      speech: all.speech ?? null,
      transcription: all.transcription ?? null
    }
  }
}

const activeModalStore = new ActiveModalityStore()

/** The chosen model id for a modality, or null to use the runtime's default. */
export function getActiveModal(kind: Modality): string | null {
  return activeModalStore.get(kind)
}

export function setActiveModal(kind: Modality, id: string | null): void {
  activeModalStore.set(kind, id)
}

export function getAllActiveModals(): Record<Modality, string | null> {
  return activeModalStore.all()
}
