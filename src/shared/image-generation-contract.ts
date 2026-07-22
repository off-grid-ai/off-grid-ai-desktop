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

export interface ImageGenerationProgressContract {
  step: number
  total: number
  secPerStep: number
  preview?: string
  phase?: 'sampling' | 'decoding'
}

export type ImageGenerationJobPhase = 'idle' | 'running' | 'succeeded' | 'failed' | 'cancelled'

/** Main-owned image job state. Renderer mounts observe this snapshot; they never
 * own or cancel a job merely because a screen unmounted. */
export interface ImageGenerationJobContract {
  id: string | null
  phase: ImageGenerationJobPhase
  conversationId: string | null
  projectId: string | null
  progress: ImageGenerationProgressContract | null
  outputPath: string | null
  error: string | null
  startedAt: number | null
  finishedAt: number | null
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
