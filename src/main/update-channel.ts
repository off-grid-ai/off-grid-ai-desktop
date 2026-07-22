// Pure resolution of electron-updater's channel knobs — deliberately free of Electron
// and DB imports so it unit-tests directly (see update-channel.test.ts).
//
// CHANNEL: it must be 'beta' for the beta/nightly channel and 'latest' for stable —
// NOT always 'latest'. electron-updater's GitHubProvider.getLatestVersion() reads
// updater.channel as the "currentChannel" and, when allowPrerelease is on, only matches
// a prerelease release whose channel is null/'alpha'/'beta' (or an exact match). With
// channel='latest' every '-beta.N' release is skipped and it throws "No published
// versions on GitHub". With channel='beta' it finds the newest beta, then fetches the
// feed: it tries beta-mac.yml, 404s (we only publish latest-mac.yml), and falls back to
// latest-mac.yml — so beta users get nightlies. Stable uses channel='latest' +
// allowPrerelease=false → the /releases/latest (non-prerelease) endpoint.
//
// allowDowngrade stays FALSE on routine launch/interval checks so a beta build (e.g.
// 0.0.41-beta.70) is never auto-"updated" to an OLDER stable (0.0.38). It is true ONLY
// on an explicit user channel switch, so a deliberate beta -> stable move can still land
// the latest stable even when its version is numerically lower.

export type UpdateChannel = 'stable' | 'beta'

export interface UpdaterChannelConfig {
  /** electron-updater feed channel: 'beta' for nightly discovery, 'latest' for stable. */
  channel: 'latest' | 'beta'
  /** Beta also accepts prerelease releases; stable does not. */
  allowPrerelease: boolean
  /** Only permitted on an explicit user channel switch, never on routine checks. */
  allowDowngrade: boolean
}

export function resolveChannelConfig(
  pref: UpdateChannel,
  explicitChannelSwitch = false
): UpdaterChannelConfig {
  const beta = pref === 'beta'
  return {
    channel: beta ? 'beta' : 'latest',
    allowPrerelease: beta,
    allowDowngrade: explicitChannelSwitch
  }
}
