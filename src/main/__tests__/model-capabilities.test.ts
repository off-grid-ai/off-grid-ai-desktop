import { describe, it, expect } from 'vitest'
import { hasVisionProjector, deriveKind } from '@offgrid/models'

// The data-derived capability rule (packages/models/src/capabilities.ts). Vision is a
// FACT about a model's files (does it ship an mmproj projector?), not a hand-typed flag.

const primary = { name: 'w.gguf', url: 'x', role: 'primary' as const }
const mmproj = { name: 'mmproj.gguf', url: 'y', role: 'mmproj' as const }

describe('hasVisionProjector', () => {
  it('is true only when a projector file is present', () => {
    expect(hasVisionProjector([primary, mmproj])).toBe(true)
    expect(hasVisionProjector([primary])).toBe(false)
    expect(hasVisionProjector([])).toBe(false)
  })
})

describe('deriveKind', () => {
  it('upgrades a chat model to vision when it ships a projector', () => {
    expect(deriveKind([primary, mmproj], 'text')).toBe('vision')
    expect(deriveKind([primary], 'text')).toBe('text')
  })
  it('keeps a declared vision model vision even before its projector is listed', () => {
    // Downgrading a curated vision entry to text just because files are incomplete would
    // hide a capability; only ADD vision from a projector, never remove a declared one.
    expect(deriveKind([primary, mmproj], 'vision')).toBe('vision')
  })
  it('never reclassifies non-chat kinds (mmproj is a chat/VLM concept)', () => {
    expect(deriveKind([primary, mmproj], 'image')).toBe('image')
    expect(deriveKind([primary, mmproj], 'voice')).toBe('voice')
    expect(deriveKind([primary, mmproj], 'transcription')).toBe('transcription')
  })
})
