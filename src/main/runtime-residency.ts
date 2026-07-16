// Residency policy for the on-device model runtimes. Each modality can run in one
// of two modes, user-selectable in settings and enforced by the ModalityQueue:
//
//   'resident'  — the model stays warm in memory between jobs (low latency), and is
//                 evicted ONLY when another modality needs the RAM (queue admission),
//                 then re-warmed when the slot frees.
//   'on-demand' — the model loads for a job and is freed right after (frees RAM,
//                 higher per-job latency). The default for the heavy image/STT paths.
//
// Concrete engines map onto these: LLM = llama-server; image = sd-cli/sd-server or
// mflux; STT = whisper-cli / whisper-server (resident) / parakeet; TTS = kokoro.
//
// The pure normalize/default logic lives here (unit-tested); the persisted getter/
// setter are the thin IO wrappers over getSetting/saveSetting.

import { getSetting, saveSetting } from './database'

export type Modality = 'llm' | 'image' | 'stt' | 'tts'
export type ResidencyMode = 'resident' | 'on-demand'

export const MODALITIES: readonly Modality[] = ['llm', 'image', 'stt', 'tts']

// Modalities LOCKED to resident — they can never be set on-demand. The chat model
// (llm) is locked because the always-on screen-replay/capture pipeline distills
// frames through it continuously; on-demand would leave it evicted after any image
// gen and the background distill would thrash-reload the ~5GB model. So it stays
// in memory (the queue still evicts it MOMENTARILY during a competing heavy job,
// then re-warms it — that's contention handling, not a user on-demand choice).
const LOCKED_RESIDENT: readonly Modality[] = ['llm']

export function isResidencyLocked(m: Modality): boolean {
  return LOCKED_RESIDENT.includes(m)
}

// Defaults deliberately MATCH today's behavior, so turning the feature on changes
// nothing until the user flips a toggle: the chat model is already a resident
// llama-server; image/STT/TTS already load per use and free after.
export const DEFAULT_RESIDENCY: Record<Modality, ResidencyMode> = {
  llm: 'resident',
  image: 'on-demand',
  stt: 'on-demand',
  tts: 'on-demand'
}

const SETTING_KEY = 'runtime:residency'

function isMode(v: unknown): v is ResidencyMode {
  return v === 'resident' || v === 'on-demand'
}

/** Coerce arbitrary persisted/IPC data into a complete, valid residency map —
 *  unknown modalities dropped, bad/missing values filled from the defaults. Pure. */
export function normalizeResidency(raw: unknown): Record<Modality, ResidencyMode> {
  const out: Record<Modality, ResidencyMode> = { ...DEFAULT_RESIDENCY }
  if (raw && typeof raw === 'object') {
    for (const m of MODALITIES) {
      const v = (raw as Record<string, unknown>)[m]
      if (isMode(v)) out[m] = v
    }
  }
  // Locked modalities are always resident, regardless of what was persisted — a
  // stale on-demand value (or a hand-edited settings file) can never take effect.
  for (const m of LOCKED_RESIDENT) out[m] = 'resident'
  return out
}

/** The full residency map (persisted, defaults applied). */
export function getResidency(): Record<Modality, ResidencyMode> {
  return normalizeResidency(getSetting<unknown>(SETTING_KEY, {}))
}

/** The residency mode for one modality. */
export function getResidencyMode(modality: Modality): ResidencyMode {
  return getResidency()[modality]
}

/** Persist the mode for one modality, returning the updated full map. A locked
 *  modality (e.g. the chat model) ignores the requested mode and stays resident. */
export function setResidencyMode(
  modality: Modality,
  mode: ResidencyMode
): Record<Modality, ResidencyMode> {
  const effective = isResidencyLocked(modality) ? 'resident' : mode
  const next = { ...getResidency(), [modality]: effective }
  saveSetting(SETTING_KEY, next)
  return next
}
