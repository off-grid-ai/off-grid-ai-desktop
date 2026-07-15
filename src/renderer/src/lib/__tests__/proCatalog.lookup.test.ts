// Tests for the pro-catalog lookup + data integrity (components/pro/proCatalog.ts).
// The existing proCatalog.nav.test.ts guards the App.tsx <-> catalog route contract;
// this file covers getProFeature's own branches and the catalog's structural invariants
// (the free build renders locked nav items straight from this data, so a malformed
// entry ships a broken upsell tab).
import { describe, it, expect } from 'vitest';
import { getProFeature, proComingSoonHere, proFeatureComingSoon, PRO_FEATURES, PRO_PAY_URL } from '../../components/pro/proCatalog';

describe('getProFeature', () => {
  it('returns the matching feature for a known route', () => {
    const f = getProFeature('day');
    expect(f).toBeDefined();
    expect(f?.route).toBe('day');
    expect(f?.label).toBe('Day');
  });

  it('returns undefined for an unknown route (the 0.0.34 white-screen guard)', () => {
    expect(getProFeature('does-not-exist')).toBeUndefined();
  });

  it('returns undefined for the empty string', () => {
    expect(getProFeature('')).toBeUndefined();
  });

  it('resolves every route present in the catalog', () => {
    for (const feature of PRO_FEATURES) {
      expect(getProFeature(feature.route)).toBe(feature);
    }
  });
});

describe('proComingSoonHere (base rule: Pro is macOS-tested only for now)', () => {
  it('is true for a Pro subscriber on any non-Mac platform', () => {
    expect(proComingSoonHere('win32', true)).toBe(true);
    expect(proComingSoonHere('linux', true)).toBe(true);
    expect(proComingSoonHere('unknown', true)).toBe(true);
  });

  it('is false on macOS', () => {
    expect(proComingSoonHere('darwin', true)).toBe(false);
  });

  it('is false for free users everywhere (they get the upsell)', () => {
    expect(proComingSoonHere('win32', false)).toBe(false);
    expect(proComingSoonHere('darwin', false)).toBe(false);
  });
});

describe('proFeatureComingSoon (Pro is macOS-tested only for now)', () => {
  const aRoute = PRO_FEATURES[0].route;

  it('shows coming-soon for a Pro subscriber on a non-Mac platform', () => {
    expect(proFeatureComingSoon(aRoute, 'win32', true)).toBe(true);
    expect(proFeatureComingSoon(aRoute, 'linux', true)).toBe(true);
  });

  it('never shows coming-soon on macOS (Pro works there)', () => {
    expect(proFeatureComingSoon(aRoute, 'darwin', true)).toBe(false);
  });

  it('never shows coming-soon to a free user (they get the upsell instead)', () => {
    expect(proFeatureComingSoon(aRoute, 'win32', false)).toBe(false);
    expect(proFeatureComingSoon(aRoute, 'linux', false)).toBe(false);
  });

  it('only applies to real Pro routes, not core/unknown views', () => {
    expect(proFeatureComingSoon('models', 'win32', true)).toBe(false);
    expect(proFeatureComingSoon('does-not-exist', 'win32', true)).toBe(false);
    expect(proFeatureComingSoon('', 'win32', true)).toBe(false);
  });

  it('gates every catalog route for a Windows Pro subscriber', () => {
    for (const f of PRO_FEATURES) {
      expect(proFeatureComingSoon(f.route, 'win32', true), `coming-soon for ${f.route}`).toBe(true);
    }
  });
});

describe('PRO_FEATURES data integrity', () => {
  it('has a non-empty catalog', () => {
    expect(PRO_FEATURES.length).toBeGreaterThan(0);
  });

  it('has unique routes', () => {
    const routes = PRO_FEATURES.map((f) => f.route);
    expect(new Set(routes).size).toBe(routes.length);
  });

  it('every feature carries the fields the upsell UI renders', () => {
    for (const f of PRO_FEATURES) {
      expect(f.route, 'route').toBeTruthy();
      expect(f.label, `label for ${f.route}`).toBeTruthy();
      expect(f.tagline, `tagline for ${f.route}`).toBeTruthy();
      expect(f.description, `description for ${f.route}`).toBeTruthy();
      // Phosphor icons are forwardRef objects, not plain functions - just assert present.
      expect(f.icon, `icon for ${f.route}`).toBeDefined();
      expect(Array.isArray(f.highlights), `highlights for ${f.route}`).toBe(true);
      expect(f.highlights.length, `highlights for ${f.route}`).toBeGreaterThan(0);
    }
  });

  it('exposes the pay URL as an https link', () => {
    expect(PRO_PAY_URL.startsWith('https://')).toBe(true);
  });
});
