import { describe, expect, it } from 'vitest'
import { toResponseGenerationResult } from '../response-result'

describe('response generation result', () => {
  it('normalizes a native length stop into the configured-cap cutoff contract', () => {
    expect(
      toResponseGenerationResult({
        content: ' capped answer ',
        finishReason: 'length',
        maxTokens: 4096
      })
    ).toEqual({
      answer: 'capped answer',
      cutoff: { reason: 'max_tokens', maxTokens: 4096 }
    })
  })

  it('does not mark a normally completed response as cut off', () => {
    expect(
      toResponseGenerationResult({ content: 'complete', finishReason: 'stop', maxTokens: 4096 })
    ).toEqual({ answer: 'complete' })
  })
})
