import type { SearchHit } from '../types'

export interface SearchNavigationPorts {
  selectEntity(entityId: number): void
  selectMemory(memoryId: number): void
  openMeeting(meetingId: number | null): void
  openChat(target: { conversationId?: string; projectId?: string } | null): void
  openReplay(timestamp: number): void
}

/** Translate the universal-search contract into renderer navigation commands.
 *
 * This is the only place that knows which destination owns each search kind.
 * The app shell supplies state-changing ports without branching on result kinds.
 */
export function navigateSearchHit(
  hit: SearchHit,
  ports: SearchNavigationPorts,
  now = Date.now()
): void {
  if (hit.kind === 'entity' || hit.kind === 'fact') {
    ports.selectEntity(hit.refId)
    return
  }
  if (hit.kind === 'memory') {
    ports.selectMemory(hit.refId)
    return
  }
  if (hit.kind === 'meeting') {
    ports.openMeeting(hit.refId || null)
    return
  }
  if (hit.kind === 'chat') {
    ports.openChat(hit.url ? { conversationId: hit.url } : null)
    return
  }
  if (hit.kind === 'doc') {
    ports.openChat(hit.url ? { projectId: hit.url } : null)
    return
  }
  ports.openReplay(hit.ts || now)
}
