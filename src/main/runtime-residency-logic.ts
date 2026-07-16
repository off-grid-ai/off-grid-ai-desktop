export type Modality = 'llm' | 'image' | 'stt' | 'tts'
export type ResidencyMode = 'resident' | 'on-demand'

export const MODALITIES: readonly Modality[] = ['llm', 'image', 'stt', 'tts']

const LOCKED_RESIDENT: readonly Modality[] = ['llm']

export function isResidencyLocked(modality: Modality): boolean {
  return LOCKED_RESIDENT.includes(modality)
}

export const DEFAULT_RESIDENCY: Record<Modality, ResidencyMode> = {
  llm: 'resident',
  image: 'on-demand',
  stt: 'on-demand',
  tts: 'on-demand'
}

function isMode(value: unknown): value is ResidencyMode {
  return value === 'resident' || value === 'on-demand'
}

/** Coerce persisted or IPC data into a complete, valid residency map. */
export function normalizeResidency(raw: unknown): Record<Modality, ResidencyMode> {
  const normalized: Record<Modality, ResidencyMode> = { ...DEFAULT_RESIDENCY }
  if (raw && typeof raw === 'object') {
    for (const modality of MODALITIES) {
      const value = (raw as Record<string, unknown>)[modality]
      if (isMode(value)) {
        normalized[modality] = value
      }
    }
  }
  for (const modality of LOCKED_RESIDENT) {
    normalized[modality] = 'resident'
  }
  return normalized
}
