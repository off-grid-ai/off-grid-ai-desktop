import type { Session } from 'electron'

type PermissionSession = Pick<Session, 'setPermissionRequestHandler'>

/**
 * Admit renderer microphone/media requests while rejecting unrelated Chromium
 * permissions. macOS still owns the actual microphone grant through TCC.
 */
export function installMediaPermissionHandler(target: PermissionSession): void {
  target.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(permission === 'media')
  })
}
