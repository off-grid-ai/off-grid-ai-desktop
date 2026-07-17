/** Electron IPC payloads shared by main, preload, and renderer type-checks. */
export interface UserProfileContract {
  role?: string
  companySize?: string
  aiUsageFrequency?: string
  primaryTools?: string[]
  painPoints?: string[]
  primaryUseCase?: string
  privacyConcern?: string
  expectedBenefit?: string
  referralSource?: string
  completedAt?: string
}

export interface RagConversationContract {
  id: string
  title: string | null
  project_id?: string | null
  created_at: string
  updated_at: string
  message_count?: number
}

export interface RagMessageContract {
  id: number
  conversation_id: string
  role: 'user' | 'assistant'
  content: string
  context: string | null
  created_at: string
}

export interface PermissionStatusContract {
  accessibility: boolean
  screenRecording: boolean
  allGranted: boolean
}

export interface CacheCleanupResultContract {
  success: true
  /** HTTP cache bytes reclaimed when Electron can measure them; null otherwise. */
  freedBytes: number | null
}

export const CACHE_CLEANUP_CHANNEL = 'storage:clear-cache'

export type ArtifactKindContract = 'html' | 'svg' | 'mermaid' | 'react' | 'text' | 'image'
