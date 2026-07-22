import { describe, it, expect } from 'vitest'
import { resolveChannelConfig } from '../update-channel'

// Regression guard for the "beta app offered an OLDER stable as an update" bug: a
// running 0.0.41-beta.69 was shown "Update 0.0.38 is ready" because applyChannel set
// allowDowngrade=true unconditionally (and pointed beta at a beta-mac.yml we never
// publish). The channel decision is now pure — assert its real output.
describe('resolveChannelConfig', () => {
  it('stable: single latest feed, no prerelease, no downgrade on routine checks', () => {
    expect(resolveChannelConfig('stable')).toEqual({
      channel: 'latest',
      allowPrerelease: false,
      allowDowngrade: false
    })
  })

  it('beta: same latest feed + prerelease, but STILL no downgrade on routine checks', () => {
    // The core fix: a beta build must never be auto-"updated" to an older stable.
    expect(resolveChannelConfig('beta')).toEqual({
      channel: 'latest',
      allowPrerelease: true,
      allowDowngrade: false
    })
  })

  it('never targets a beta-mac.yml feed — we publish only latest-mac.yml', () => {
    expect(resolveChannelConfig('beta').channel).toBe('latest')
    expect(resolveChannelConfig('stable').channel).toBe('latest')
  })

  it('permits a downgrade ONLY on an explicit channel switch (beta → stable graduation)', () => {
    expect(resolveChannelConfig('stable', true).allowDowngrade).toBe(true)
    expect(resolveChannelConfig('beta', true).allowDowngrade).toBe(true)
    // The prerelease/feed knobs are unchanged by the explicit-switch flag.
    expect(resolveChannelConfig('beta', true).allowPrerelease).toBe(true)
    expect(resolveChannelConfig('stable', true).allowPrerelease).toBe(false)
  })
})
