import { describe, it, expect } from 'vitest'
import { resolveChannelConfig } from '../update-channel'

// Two regressions guarded here:
//  1. A beta build (0.0.41-beta.69) was offered an OLDER stable (0.0.38) as an "update"
//     because applyChannel set allowDowngrade=true unconditionally.
//  2. Forcing channel='latest' for beta then broke discovery entirely — electron-updater's
//     GitHubProvider only matches a prerelease when updater.channel is null/'alpha'/'beta',
//     so 'latest' skipped every '-beta.N' release → "No published versions on GitHub".
describe('resolveChannelConfig', () => {
  it('stable: latest feed, no prerelease, no downgrade on routine checks', () => {
    expect(resolveChannelConfig('stable')).toEqual({
      channel: 'latest',
      allowPrerelease: false,
      allowDowngrade: false
    })
  })

  it('beta: channel MUST be "beta" (not "latest") so prerelease discovery works', () => {
    // channel='beta' is required for GitHubProvider to match '-beta.N' releases; it then
    // falls back from the (absent) beta-mac.yml to latest-mac.yml for the actual feed.
    expect(resolveChannelConfig('beta')).toEqual({
      channel: 'beta',
      allowPrerelease: true,
      allowDowngrade: false
    })
  })

  it('permits a downgrade ONLY on an explicit channel switch (beta → stable graduation)', () => {
    expect(resolveChannelConfig('stable', true).allowDowngrade).toBe(true)
    expect(resolveChannelConfig('beta', true).allowDowngrade).toBe(true)
    // The channel + prerelease knobs are unchanged by the explicit-switch flag.
    expect(resolveChannelConfig('beta', true).channel).toBe('beta')
    expect(resolveChannelConfig('beta', true).allowPrerelease).toBe(true)
    expect(resolveChannelConfig('stable', true).channel).toBe('latest')
    expect(resolveChannelConfig('stable', true).allowPrerelease).toBe(false)
  })
})
