import { describe, it, expect } from 'vitest'
import { tagLlmEntry, tagLlmEntries, modelEntry, ollamaMirror } from '../models-list'

describe('tagLlmEntry', () => {
  it('tags an entry with multimodal capability as vision', () => {
    expect(tagLlmEntry({ id: 'm', capabilities: ['multimodal'] })).toEqual({
      id: 'm',
      capabilities: ['multimodal'],
      kind: 'vision'
    })
  })

  it('tags an entry advertising vision as vision', () => {
    expect(tagLlmEntry({ id: 'm', capabilities: ['vision'] }).kind).toBe('vision')
  })

  it('tags an entry with neither as chat', () => {
    expect(tagLlmEntry({ id: 'm', capabilities: ['completion'] }).kind).toBe('chat')
  })

  it('tags an entry with no capabilities array as chat', () => {
    expect(tagLlmEntry({ id: 'm' }).kind).toBe('chat')
    expect(tagLlmEntry({ id: 'm', capabilities: 'nope' }).kind).toBe('chat')
  })

  it('preserves the original fields', () => {
    expect(tagLlmEntry({ id: 'm', object: 'model', extra: 1 })).toMatchObject({
      id: 'm',
      object: 'model',
      extra: 1
    })
  })
})

describe('tagLlmEntries', () => {
  it('tags every entry', () => {
    const out = tagLlmEntries([
      { id: 'a', capabilities: ['vision'] },
      { id: 'b', capabilities: [] }
    ])
    expect(out.map((m) => m.kind)).toEqual(['vision', 'chat'])
  })

  it('returns an empty list unchanged', () => {
    expect(tagLlmEntries([])).toEqual([])
  })
})

describe('modelEntry', () => {
  it('builds a canonical entry', () => {
    expect(modelEntry('kokoro', 'speech', 1000)).toEqual({
      id: 'kokoro',
      object: 'model',
      created: 1000,
      owned_by: 'off-grid',
      kind: 'speech'
    })
  })

  it('folds in extra fields (e.g. voices)', () => {
    expect(modelEntry('kokoro', 'speech', 1000, { voices: ['a', 'b'] })).toMatchObject({
      id: 'kokoro',
      kind: 'speech',
      voices: ['a', 'b']
    })
  })
})

describe('ollamaMirror', () => {
  it('mirrors id + kind into the ollama shape', () => {
    const data = [
      { id: 'x', kind: 'chat' },
      { id: 'y', kind: 'image' }
    ]
    expect(ollamaMirror(data)).toEqual([
      { name: 'x', model: 'x', type: 'model', kind: 'chat' },
      { name: 'y', model: 'y', type: 'model', kind: 'image' }
    ])
  })

  it('mirrors an empty list', () => {
    expect(ollamaMirror([])).toEqual([])
  })
})
