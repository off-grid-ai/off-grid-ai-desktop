import { describe, it, expect } from 'vitest';
import { proSurfaceState } from '../pro-availability';

// The single rule that decides how every Pro surface (nav, view-router, Settings)
// presents itself. Windows is the coming-soon platform; macOS follows the license.
describe('proSurfaceState', () => {
  it('macOS + licensed → active', () => {
    expect(proSurfaceState({ isPro: true, platform: 'darwin' })).toBe('active');
  });

  it('macOS + free → locked (upgrade teaser)', () => {
    expect(proSurfaceState({ isPro: false, platform: 'darwin' })).toBe('locked');
  });

  it('Windows + free → coming-soon', () => {
    expect(proSurfaceState({ isPro: false, platform: 'win32' })).toBe('coming-soon');
  });

  it('Windows + licensed → coming-soon (a license cannot run Pro on Windows yet)', () => {
    // The load-bearing case: even a paying user on Windows must see "coming soon",
    // never the real (non-existent on Windows) feature. If this ever returns
    // 'active', a licensed Windows build would try to render Pro screens.
    expect(proSurfaceState({ isPro: true, platform: 'win32' })).toBe('coming-soon');
  });

  it('other platforms follow the license (only win32 is gated)', () => {
    expect(proSurfaceState({ isPro: true, platform: 'linux' })).toBe('active');
    expect(proSurfaceState({ isPro: false, platform: 'linux' })).toBe('locked');
  });
});
