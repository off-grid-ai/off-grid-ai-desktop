/**
 * Shared types for chat message parsers.
 * This is the ONLY shared code between parsers - just the interface definition.
 */

export interface ParseResult {
  messages: { role: string; content: string; timestamp?: string }[]
  chatTitle?: string
  windowTitle?: string
  browserUrl?: string
}
