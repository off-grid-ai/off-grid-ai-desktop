export type SearchKind = 'screen' | 'meeting' | 'memory' | 'entity' | 'fact' | 'chat' | 'doc'

export type SearchSort = 'relevance' | 'recency' | 'match'

/** Stable universal-search result shared by main, preload, and renderer. */
export interface SearchResult {
  key: string
  kind: SearchKind
  refId: number
  title: string
  snippet: string
  surface: string
  url: string | null
  ts: number
  imagePath: string | null
  score: number
}
