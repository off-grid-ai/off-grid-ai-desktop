import { describe, expect, it } from 'vitest'
import { PRO_PURCHASE_URL } from '../product-links'

describe('product links', () => {
  it('routes every Pro purchase action to the canonical buy section', () => {
    expect(PRO_PURCHASE_URL).toBe('https://getoffgridai.co/pro/#buy')
    expect(PRO_PURCHASE_URL).not.toContain('/pay')
  })
})
