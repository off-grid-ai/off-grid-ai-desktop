// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { initFocusModality } from '../focus-modality'

describe('focus modality tracking', () => {
  beforeEach(() => {
    delete document.documentElement.dataset.userModality
    initFocusModality()
  })

  const modality = (): string | undefined => document.documentElement.dataset.userModality

  it('flips to keyboard on Tab navigation', () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab' }))
    expect(modality()).toBe('keyboard')
  })

  it('flips to pointer on a mouse/pointer press', () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab' }))
    window.dispatchEvent(new Event('pointerdown'))
    expect(modality()).toBe('pointer')
  })

  it('does NOT flip to keyboard while typing into a pointer-focused field', () => {
    // Mouse-focus a field, then type — the ring must not pop in mid-typing.
    window.dispatchEvent(new Event('pointerdown'))
    for (const key of ['a', 'B', '1', ' ', 'Enter', 'Backspace']) {
      window.dispatchEvent(new KeyboardEvent('keydown', { key }))
    }
    expect(modality()).toBe('pointer')
  })

  it('flips to keyboard on arrow-key navigation', () => {
    window.dispatchEvent(new Event('pointerdown'))
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }))
    expect(modality()).toBe('keyboard')
  })
})
