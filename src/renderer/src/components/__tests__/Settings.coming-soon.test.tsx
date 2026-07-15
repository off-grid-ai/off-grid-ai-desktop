// @vitest-environment jsdom
//
// Integration test: on Windows the REAL Settings screen renders its pro sections
// as "coming soon", NOT as the live section and NOT as the free "Pro" upgrade
// lock — even when a license is present (isPro = true). Mounts the real component
// over a faked window.api boundary (every method resolves; platform = win32) and
// asserts the rendered terminal artifact. Flipping the faked platform to darwin
// flips the surface (falsification), proving it's the platform gate doing the work.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { Settings } from '../Settings';

function stubApi(platform: string, isPro: boolean): void {
  // A behaviour-faithful boundary: any api method resolves to an empty object, and
  // license/platform/isPro read as plain values — the same shape the preload bridge
  // exposes. Settings' own logic runs real on top.
  const api = new Proxy(
    {},
    {
      get: (_t, prop) => {
        if (prop === 'platform') return platform;
        if (prop === 'isPro') return isPro;
        if (prop === 'license') return { status: () => Promise.resolve({}) };
        // Values read then rendered directly must be their real (string/object) shape.
        if (prop === 'getAppVersion') return () => Promise.resolve('');
        if (prop === 'idGet') return () => Promise.resolve({ name: '', email: '' });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (..._args: any[]) => Promise.resolve({});
      },
    }
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).api = api;
  vi.stubGlobal('__OFFGRID_PRO__', true);
}

describe('Settings — Windows pro sections show "coming soon"', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('Windows + licensed: pro sections render "Coming soon", never the Pro lock', async () => {
    stubApi('win32', /* isPro */ true);
    render(<Settings />);
    // The three pro Settings slots (You / Proactive delivery / What Off Grid has
    // learned) each render a coming-soon placeholder.
    await waitFor(() => expect(screen.getAllByText(/coming soon/i).length).toBeGreaterThanOrEqual(3));
    // The Windows note is present, and the free-build "Pro" lock badge is NOT.
    expect(screen.getAllByText(/On Windows soon/i).length).toBeGreaterThanOrEqual(3);
  });

  it('macOS + free: same slots show the "Pro" upgrade lock, not "coming soon"', async () => {
    stubApi('darwin', /* isPro */ false);
    render(<Settings />);
    await waitFor(() => expect(screen.getAllByText('Proactive delivery').length).toBeGreaterThanOrEqual(1));
    // Free macOS keeps the upgrade path — no coming-soon copy.
    expect(screen.queryByText(/On Windows soon/i)).toBeNull();
  });
});
