import type { ResponseCutoffContract } from '../../shared/ipc-contracts'

export interface ResponseGenerationResult {
  answer: string
  cutoff?: ResponseCutoffContract
}

/** Normalize engine-specific completion metadata at the main-process boundary. */
export function toResponseGenerationResult(result: {
  content: string
  finishReason: string | null
  maxTokens: number
}): ResponseGenerationResult {
  return {
    answer: result.content.trim(),
    ...(result.finishReason === 'length'
      ? { cutoff: { reason: 'max_tokens' as const, maxTokens: result.maxTokens } }
      : {})
  }
}
