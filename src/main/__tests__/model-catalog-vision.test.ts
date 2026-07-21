import { describe, it, expect } from 'vitest'
import { CATALOG } from '@offgrid/models'

// The chat engine decides "can this model read images" purely from whether the ACTIVE
// model has an mmproj file (llm.ts hasVision → models-manager reads
// entry.files.find(role === 'mmproj')). So a vision model that omits its mmproj in the
// catalog is silently demoted to text-only in the UI ("This model can't read images").
// That's exactly what happened to Gemma 4 E2B — a multimodal model catalogued as
// kind:'text' with no projector. These guards tie the capability to the data.

type Entry = { id: string; name?: string; kind: string; files: { role?: string }[] }
const entries = CATALOG as unknown as Entry[]

describe('model catalog — vision capability matches the mmproj data', () => {
  it('Gemma 4 E2B is a vision model with a projector (regression)', () => {
    const e2b = entries.find((m) => m.id === 'unsloth/gemma-4-E2B-it-GGUF')
    expect(e2b, 'E2B must be in the catalog').toBeTruthy()
    expect(e2b!.kind).toBe('vision')
    expect(e2b!.files.some((f) => f.role === 'mmproj')).toBe(true)
  })

  it('every vision model ships an mmproj, and no text model carries one', () => {
    // The invariant the engine relies on: kind==='vision' ⇔ a role:'mmproj' file. If a
    // future entry breaks it, the model would either claim vision it can't do or hide
    // vision it can — both are the bug this test exists to catch.
    for (const m of entries) {
      const hasMmproj = m.files.some((f) => f.role === 'mmproj')
      if (m.kind === 'vision') {
        expect(hasMmproj, `${m.id} is vision but has no mmproj`).toBe(true)
      } else {
        expect(hasMmproj, `${m.id} is ${m.kind} but carries an mmproj`).toBe(false)
      }
    }
  })

  it('every model has exactly one primary weight file', () => {
    for (const m of entries) {
      expect(m.files.filter((f) => f.role === 'primary').length, `${m.id}`).toBe(1)
    }
  })
})
