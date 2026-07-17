import { describe, expect, it } from 'vitest'
import { createUiId } from '../ui-id'

describe('createUiId', () => {
  it('uses a cryptographically secure UUID and preserves the caller prefix', () => {
    const first = createUiId('att')
    const second = createUiId('att')

    expect(first).toMatch(
      /^att-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    )
    expect(second).not.toBe(first)
  })
})
