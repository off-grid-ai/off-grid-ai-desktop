// Tests for the pro-catalog lookup + data integrity (components/pro/proCatalog.ts).
// The existing proCatalog.nav.test.ts guards the App.tsx <-> catalog route contract;
// this file covers getProFeature's own branches and the catalog's structural invariants
// (the free build renders locked nav items straight from this data, so a malformed
// entry ships a broken upsell tab).
import { describe, it, expect } from 'vitest'
import {
  getProFeature,
  proComingSoonHere,
  proFeatureComingSoon,
  PRO_FEATURES,
  PRO_PAY_URL
} from '../../components/pro/proCatalog'

describe('getProFeature', () => {
  it('returns the matching feature for a known route', () => {
    const f = getProFeature('day')
    expect(f).toBeDefined()
    expect(f?.route).toBe('day')
    expect(f?.label).toBe('Day')
  })

  it('returns undefined for an unknown route (the 0.0.34 white-screen guard)', () => {
    expect(getProFeature('does-not-exist')).toBeUndefined()
  })

  it('returns undefined for the empty string', () => {
    expect(getProFeature('')).toBeUndefined()
  })

  it('resolves every route present in the catalog', () => {
    for (const feature of PRO_FEATURES) {
      expect(getProFeature(feature.route)).toBe(feature)
    }
  })
})

describe('proComingSoonHere', () => {
  it('gates Pro subscribers on non-Mac platforms', () => {
    expect(proComingSoonHere('win32', true)).toBe(true)
    expect(proComingSoonHere('linux', true)).toBe(true)
    expect(proComingSoonHere('unknown', true)).toBe(true)
  })

  it('does not gate Mac subscribers or free users', () => {
    expect(proComingSoonHere('darwin', true)).toBe(false)
    expect(proComingSoonHere('win32', false)).toBe(false)
    expect(proComingSoonHere('darwin', false)).toBe(false)
  })
})

describe('proFeatureComingSoon', () => {
  it('gates every Pro route for a Windows Pro subscriber', () => {
    for (const feature of PRO_FEATURES) {
      expect(
        proFeatureComingSoon(feature.route, 'win32', true),
        `coming-soon for ${feature.route}`
      ).toBe(true)
    }
  })

  it('does not gate routes on Mac or for free users', () => {
    const route = PRO_FEATURES.at(0)?.route
    if (!route) throw new Error('Pro catalog must not be empty')
    expect(proFeatureComingSoon(route, 'darwin', true)).toBe(false)
    expect(proFeatureComingSoon(route, 'win32', false)).toBe(false)
  })

  it('does not gate core or unknown routes', () => {
    expect(proFeatureComingSoon('models', 'win32', true)).toBe(false)
    expect(proFeatureComingSoon('does-not-exist', 'win32', true)).toBe(false)
    expect(proFeatureComingSoon('', 'win32', true)).toBe(false)
  })
})

describe('PRO_FEATURES data integrity', () => {
  it('has a non-empty catalog', () => {
    expect(PRO_FEATURES.length).toBeGreaterThan(0)
  })

  it('has unique routes', () => {
    const routes = PRO_FEATURES.map((f) => f.route)
    expect(new Set(routes).size).toBe(routes.length)
  })

  it('every feature carries the fields the upsell UI renders', () => {
    for (const f of PRO_FEATURES) {
      expect(f.route, 'route').toBeTruthy()
      expect(f.label, `label for ${f.route}`).toBeTruthy()
      expect(f.tagline, `tagline for ${f.route}`).toBeTruthy()
      expect(f.description, `description for ${f.route}`).toBeTruthy()
      // Phosphor icons are forwardRef objects, not plain functions - just assert present.
      expect(f.icon, `icon for ${f.route}`).toBeDefined()
      expect(Array.isArray(f.highlights), `highlights for ${f.route}`).toBe(true)
      expect(f.highlights.length, `highlights for ${f.route}`).toBeGreaterThan(0)
    }
  })

  it('exposes the pay URL as an https link', () => {
    expect(PRO_PAY_URL.startsWith('https://')).toBe(true)
  })
})
