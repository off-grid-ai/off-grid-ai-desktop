// Tests for external-link helpers (constants/links.ts). openExternal has a real
// branch: use the preload bridge (window.api.openExternal) when present, else fall
// back to window.open. We stub the two globals directly (no DOM rendering needed);
// the boundary being crossed - a window global - is exactly the seam under test.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { openExternal, OFF_GRID_WEBSITE_URL, OFF_GRID_MOBILE_URL } from '../../constants/links';

// Preserve/restore whatever `window` was so the suite leaves no global residue.
const hadWindow = 'window' in globalThis;
const originalWindow = (globalThis as { window?: unknown }).window;

function setWindow(value: unknown): void {
  (globalThis as { window?: unknown }).window = value;
}

describe('links', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    if (hadWindow) setWindow(originalWindow);
    else delete (globalThis as { window?: unknown }).window;
  });

  it('exposes the marketing URLs as https links', () => {
    expect(OFF_GRID_WEBSITE_URL).toBe('https://getoffgridai.co');
    expect(OFF_GRID_MOBILE_URL).toBe('https://getoffgridai.co/mobile');
  });

  it('routes through window.api.openExternal when the bridge is present', () => {
    const openExternalSpy = vi.fn();
    const openSpy = vi.fn();
    setWindow({ api: { openExternal: openExternalSpy }, open: openSpy });

    openExternal('https://example.com');

    expect(openExternalSpy).toHaveBeenCalledWith('https://example.com');
    expect(openSpy).not.toHaveBeenCalled();
  });

  it('falls back to window.open when the bridge is absent', () => {
    const openSpy = vi.fn();
    setWindow({ open: openSpy });

    openExternal('https://example.com');

    expect(openSpy).toHaveBeenCalledWith('https://example.com', '_blank');
  });

  it('falls back to window.open when api has no openExternal method', () => {
    const openSpy = vi.fn();
    setWindow({ api: {}, open: openSpy });

    openExternal('https://example.com');

    expect(openSpy).toHaveBeenCalledWith('https://example.com', '_blank');
  });
});
