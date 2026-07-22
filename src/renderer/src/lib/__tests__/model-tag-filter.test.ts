import { describe, it, expect } from 'vitest'
import { collectTags, matchesAllTags, toggleTag } from '../model-tag-filter'

const models = [
  { id: 'a', tags: ['Fast', 'Photoreal'] },
  { id: 'b', tags: ['Light', 'Photoreal'] },
  { id: 'c', tags: ['Anime'] },
  { id: 'd' } // no tags
]

describe('collectTags', () => {
  it('returns each tag once, in first-seen order', () => {
    expect(collectTags(models)).toEqual(['Fast', 'Photoreal', 'Light', 'Anime'])
  })
})

describe('matchesAllTags (AND)', () => {
  it('empty selection matches everything', () => {
    expect(matchesAllTags(['Fast'], [])).toBe(true)
    expect(matchesAllTags(undefined, [])).toBe(true)
  })
  it('requires every selected tag to be present', () => {
    expect(matchesAllTags(['Light', 'Photoreal'], ['Photoreal'])).toBe(true)
    expect(matchesAllTags(['Light', 'Photoreal'], ['Light', 'Photoreal'])).toBe(true)
    expect(matchesAllTags(['Light', 'Photoreal'], ['Fast'])).toBe(false)
    expect(matchesAllTags(['Light'], ['Light', 'Photoreal'])).toBe(false)
    expect(matchesAllTags(undefined, ['Light'])).toBe(false)
  })
})

describe('toggleTag', () => {
  it('adds when absent, removes when present', () => {
    expect(toggleTag([], 'Light')).toEqual(['Light'])
    expect(toggleTag(['Light'], 'Photoreal')).toEqual(['Light', 'Photoreal'])
    expect(toggleTag(['Light', 'Photoreal'], 'Light')).toEqual(['Photoreal'])
  })
})
