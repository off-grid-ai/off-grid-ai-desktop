export const NOTIFICATION_METADATA_HOOK = 'notifications:metadata'
export const NOTIFICATION_RESOLVE_TARGET_HOOK = 'notifications:resolve-target'
export const NOTIFICATION_OPEN_TARGET_CHANNEL = 'notification:open-target'

export interface NotificationSourceRecord {
  source: 'approval' | 'action'
  recordId: number
}

export interface NotificationRoutingMetadata {
  dedupeKey: string
  target: unknown
}
