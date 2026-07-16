import type { ReactNode } from 'react'
import type { SearchHit } from '../types'

// Pro view-router seam. Pro registers ONE function that renders the right pro
// screen for a given view mode, given a context bag of the shell's state +
// handlers. Core delegates non-core views to it; when no pro is active it returns
// null and core shows the UpgradeScreen instead. This keeps all the per-screen
// prop wiring inside pro (where the screens live).

export interface ProViewContext {
  setView: (view: string) => void
  replayTarget: number | null
  setReplayTarget: (ms: number | null) => void
  meetingTarget: number | null
  actionsMode: 'todo' | 'approvals' | null
  setActionsMode: (m: 'todo' | 'approvals' | null) => void
  // When set, the Actions to-do list opens filtered to this entity ("all to-dos for Ali").
  actionsEntity: { id: number; name: string } | null
  setActionsEntity: (e: { id: number; name: string } | null) => void
  searchQuery: string
  onSearchQueryChange: (q: string) => void
  searchSources: string[]
  onSearchSourcesChange: (s: string[]) => void
  searchSort: 'relevance' | 'recency' | 'match'
  onSearchSortChange: (s: 'relevance' | 'recency' | 'match') => void
  selectedMemoryId: number | null
  setSelectedMemoryId: (id: number | null) => void
  selectedEntityId: number | null
  // The meeting-recorder handle (typed loosely so core needn't know its shape).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rec: any
  onSelectEntity: (id: number) => void
  onSelectMemory: (id: number) => void
  onOpenHit: (hit: SearchHit) => void
}

export type ProViewRenderer = (viewMode: string, ctx: ProViewContext) => ReactNode | null

let renderer: ProViewRenderer | null = null

export function registerProView(fn: ProViewRenderer): void {
  renderer = fn
}

export function renderProView(viewMode: string, ctx: ProViewContext): ReactNode | null {
  return renderer ? renderer(viewMode, ctx) : null
}
