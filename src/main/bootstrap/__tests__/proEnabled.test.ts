import { describe, expect, it } from 'vitest'
import { getForcedProActivation } from '../pro-activation'

describe('getForcedProActivation', () => {
  it('always disables pro when the private package is not bundled', () => {
    expect(getForcedProActivation(false, undefined)).toBe(false)
    expect(getForcedProActivation(false, '1')).toBe(false)
  })

  it('forces free mode when OFFGRID_PRO is 0', () => {
    expect(getForcedProActivation(true, '0')).toBe(false)
  })

  it('forces pro mode when OFFGRID_PRO is 1', () => {
    expect(getForcedProActivation(true, '1')).toBe(true)
  })

  it('defers to license entitlement when no recognized override exists', () => {
    expect(getForcedProActivation(true, undefined)).toBeUndefined()
    expect(getForcedProActivation(true, 'yes')).toBeUndefined()
  })
})
