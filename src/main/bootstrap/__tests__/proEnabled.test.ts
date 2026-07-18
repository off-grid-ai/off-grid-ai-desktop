import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { getForcedProActivation } from '../pro-activation'

const MAIN_ACTIVATION_SOURCE = path.resolve(__dirname, '../loadProFeaturesMain.ts')

describe('getForcedProActivation', () => {
  it('always disables pro when the private package is not bundled', () => {
    expect(getForcedProActivation(false, undefined, false)).toBe(false)
    expect(getForcedProActivation(false, '1', false)).toBe(false)
  })

  it('forces free mode when OFFGRID_PRO is 0', () => {
    expect(getForcedProActivation(true, '0', false)).toBe(false)
    expect(getForcedProActivation(true, '0', true)).toBe(false)
  })

  it('forces pro mode from OFFGRID_PRO only during development', () => {
    expect(getForcedProActivation(true, '1', false)).toBe(true)
    expect(getForcedProActivation(true, '1', true)).toBeUndefined()
  })

  it('defers to license entitlement when no recognized override exists', () => {
    expect(getForcedProActivation(true, undefined, false)).toBeUndefined()
    expect(getForcedProActivation(true, 'yes', false)).toBeUndefined()
    expect(getForcedProActivation(true, undefined, true)).toBeUndefined()
  })

  it('uses Electron packaging state directly instead of an environment-overridable runtime hint', () => {
    const source = fs.readFileSync(MAIN_ACTIVATION_SOURCE, 'utf8')

    expect(source).toContain('app.isPackaged')
    expect(source).not.toContain("from '../runtime-env'")
    expect(source).not.toContain('OFFGRID_PACKAGED')
  })
})
