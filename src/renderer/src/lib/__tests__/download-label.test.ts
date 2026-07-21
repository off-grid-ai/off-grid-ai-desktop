import { describe, it, expect } from 'vitest'
import { companionDownloadLabel } from '../download-label'

describe('companionDownloadLabel', () => {
  it('labels a vision projector so it does not read as a full re-download', () => {
    expect(companionDownloadLabel('mmproj-gemma-4-E2B-it-F16.gguf')).toBe('vision projector')
    expect(companionDownloadLabel('mmproj-BF16.gguf')).toBe('vision projector')
    expect(companionDownloadLabel('clip-vit.gguf')).toBe('vision projector')
  })
  it('returns null for primary weights (no special label) and empty input', () => {
    expect(companionDownloadLabel('gemma-4-E2B-it-Q4_K_M.gguf')).toBeNull()
    expect(companionDownloadLabel(undefined)).toBeNull()
    expect(companionDownloadLabel(null)).toBeNull()
    expect(companionDownloadLabel('')).toBeNull()
  })
})
