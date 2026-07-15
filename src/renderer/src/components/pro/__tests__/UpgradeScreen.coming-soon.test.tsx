// @vitest-environment jsdom
//
// Terminal-artifact test for the Windows "coming soon" pro surface. On Windows,
// App renders <UpgradeScreen ... comingSoon /> for every pro tab (proSurfaceState
// returns 'coming-soon'). The Windows user must SEE a coming-soon writeup and must
// NOT see a purchase path (buying can't unlock Pro on Windows yet). This mounts the
// REAL component and asserts what renders — flipping the `comingSoon` prop flips the
// surface, so the two cases falsify each other.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { UpgradeScreen } from '../UpgradeScreen';
import { getProFeature } from '../proCatalog';

describe('UpgradeScreen — Windows coming-soon variant', () => {
  beforeEach(() => {
    // Single shipped build defines this true; provide it so the default (buy) variant renders.
    vi.stubGlobal('__OFFGRID_PRO__', true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).api = { openExternal: vi.fn() };
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('comingSoon: shows the coming-soon note + badge, and NO purchase CTA', () => {
    render(<UpgradeScreen feature={getProFeature('vault')} comingSoon />);
    // Still advertises WHAT the feature does (the pitch is shared)...
    expect(screen.getByRole('heading', { name: 'Vault' })).toBeTruthy();
    // ...but the action panel is coming-soon, not buy.
    expect(screen.getByText(/coming soon on windows/i)).toBeTruthy();
    expect(screen.getByText(/being built for Windows/i)).toBeTruthy();
    // The purchase path must be absent on Windows.
    expect(screen.queryByText(/Get Pro/)).toBeNull();
    expect(screen.queryByText(/Enter your license key/i)).toBeNull();
  });

  it('default (macOS): shows the purchase CTA, and NO coming-soon note', () => {
    render(<UpgradeScreen feature={getProFeature('vault')} />);
    expect(screen.getByText(/Get Pro/)).toBeTruthy();
    expect(screen.getByText(/Available now/i)).toBeTruthy();
    expect(screen.queryByText(/being built for Windows/i)).toBeNull();
  });
});
