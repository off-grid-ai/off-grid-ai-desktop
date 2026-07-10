/**
 * Regression guard for the 0.0.34 WHITE-SCREEN bug: App.tsx shipped a
 * `proItem('voice')` nav entry, but no `voice` entry existed in PRO_FEATURES.
 * proItem did `getProFeature(route)!` (the `!` is compile-time only), so
 * getProFeature returned undefined and `f.label` threw a TypeError during
 * render. No error boundary wraps the nav, so the whole app went blank for
 * every user on boot.
 *
 * This test fails if any `proItem('<route>')` referenced in App.tsx is missing
 * a matching ProFeature in the catalog — the exact contract that broke.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { getProFeature } from '../proCatalog';

const APP = path.resolve(process.cwd(), 'src/renderer/src/App.tsx');
const SRC = fs.readFileSync(APP, 'utf-8');

// Every route the nav builds from the catalog: proItem('search'), proItem('day'), …
const routes = [...SRC.matchAll(/proItem\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]!);

describe('App nav ↔ pro catalog contract', () => {
  it('references at least one pro nav item (sanity)', () => {
    expect(routes.length).toBeGreaterThan(0);
  });

  it('every proItem() route has a matching PRO_FEATURES entry', () => {
    const missing = routes.filter((r) => !getProFeature(r));
    expect(missing, `proItem() routes with no catalog entry: ${missing.join(', ')}`).toEqual([]);
  });
});
