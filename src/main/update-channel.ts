// Pure resolution of electron-updater's channel knobs — deliberately free of Electron
// and DB imports so it unit-tests directly (see update-channel.test.ts).
//
// We publish ONE update feed, latest-mac.yml, for BOTH channels: a beta build is just
// a GitHub *prerelease* carrying that same feed (see release.yml). So the updater
// channel is ALWAYS 'latest'; the only difference for beta is allowPrerelease=true so
// the updater also considers prerelease releases. Pointing channel at 'beta' made it
// fetch a beta-mac.yml that is never published — beta users then saw no updates.
//
// allowDowngrade stays FALSE on routine launch/interval checks: a beta such as
// 0.0.41-beta.69 must never be auto-"updated" to an OLDER stable like 0.0.38 (that is
// the "why is 0.0.38 offered on a 0.0.41 app" bug). It is true ONLY when the user
// explicitly switches channels, so a deliberate beta -> stable move can land the
// latest stable even though its version is numerically lower than the beta.

export type UpdateChannel = 'stable' | 'beta'

export interface UpdaterChannelConfig {
  /** Always the single published feed (latest-mac.yml). */
  channel: 'latest'
  /** Beta also accepts prerelease releases; stable does not. */
  allowPrerelease: boolean
  /** Only permitted on an explicit user channel switch, never on routine checks. */
  allowDowngrade: boolean
}

export function resolveChannelConfig(
  pref: UpdateChannel,
  explicitChannelSwitch = false
): UpdaterChannelConfig {
  return {
    channel: 'latest',
    allowPrerelease: pref === 'beta',
    allowDowngrade: explicitChannelSwitch
  }
}
