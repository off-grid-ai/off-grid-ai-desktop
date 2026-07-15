// Single source of truth for how a Pro surface should present itself, given the
// license state and the platform it's running on. Pro is built for macOS today;
// the Windows build ships the app shell but NOT the Pro feature set yet, so every
// Pro surface shows "coming soon" on Windows regardless of license (a licensed
// user on Windows still can't run the Pro features). Consumed by the sidebar nav,
// the pro view-router fallback, and the Settings pro sections — the rule lives
// here ONCE so those three layers can never drift.

export type ProSurfaceState =
  | 'active' // pro is licensed AND runnable here — render the real feature
  | 'locked' // free build on a supported platform — render the upgrade teaser
  | 'coming-soon'; // platform without Pro yet (Windows) — render the coming-soon teaser

export function proSurfaceState(opts: { isPro: boolean; platform: string }): ProSurfaceState {
  // Windows: Pro isn't available yet. Show "coming soon" whether or not a license
  // is present — the feature code doesn't run here, so activating a key changes
  // nothing on this platform.
  if (opts.platform === 'win32') {
    return 'coming-soon';
  }
  return opts.isPro ? 'active' : 'locked';
}

/** Read the platform the renderer is running on, exposed by the preload bridge.
 *  Defaults to 'darwin' when the bridge is missing (e.g. a bare test mount) so a
 *  missing bridge never accidentally trips the coming-soon path on the primary
 *  platform. */
export function currentPlatform(): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (window as any).api?.platform ?? 'darwin';
}
