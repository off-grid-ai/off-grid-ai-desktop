import { describe, it, expect } from 'vitest'
import { cn } from '../utils'

describe('cn — class name merge', () => {
  it('joins truthy class names', () => {
    expect(cn('a', 'b', 'c')).toBe('a b c')
  })

  it('drops falsy / conditional entries', () => {
    expect(cn('a', false, null, undefined, '', 'b')).toBe('a b')
    expect(cn('base', { active: true, hidden: false })).toBe('base active')
  })

  it('resolves conflicting Tailwind utilities (last one wins)', () => {
    // twMerge collapses same-property utilities to the final value.
    expect(cn('px-2', 'px-4')).toBe('px-4')
    expect(cn('text-sm text-red-500', 'text-lg')).toBe('text-red-500 text-lg')
  })

  it('returns an empty string for no meaningful input', () => {
    expect(cn()).toBe('')
    expect(cn(false, null, undefined)).toBe('')
  })
})
