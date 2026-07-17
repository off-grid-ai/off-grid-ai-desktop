/** Image-generation request shared by main, preload, and renderer. */
export interface ImageGenerationRequestContract {
  prompt: string
  negativePrompt?: string
  width?: number
  height?: number
  steps?: number
  seed?: number
  cfgScale?: number
  /** Model filename in the models directory, or a virtual MLX model id. */
  model?: string
  initImage?: string
  strength?: number
  loras?: { name: string; weight: number }[]
  fastVae?: boolean
  /** Explicit user acknowledgement that an over-budget model may make the Mac unresponsive. */
  allowUnsafeMemoryOverride?: boolean
}

export const IMAGE_MEMORY_GUARD_ERROR_CODE = 'OFFGRID_IMAGE_MEMORY_LIMIT'

export interface ImageMemoryGuardErrorContract {
  code: typeof IMAGE_MEMORY_GUARD_ERROR_CODE
  message: string
}

/** IPC preserves Error.message but not custom Error subclasses or properties. */
export function imageMemoryGuardErrorMessage(message: string): string {
  return `${IMAGE_MEMORY_GUARD_ERROR_CODE}:${message}`
}

export function parseImageMemoryGuardError(error: unknown): ImageMemoryGuardErrorContract | null {
  const raw = error instanceof Error ? error.message : String(error ?? '')
  const marker = `${IMAGE_MEMORY_GUARD_ERROR_CODE}:`
  const markerIndex = raw.indexOf(marker)
  if (markerIndex < 0) return null
  return {
    code: IMAGE_MEMORY_GUARD_ERROR_CODE,
    message: raw.slice(markerIndex + marker.length).trim()
  }
}
