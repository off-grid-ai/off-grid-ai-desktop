/** Parse tagged OCR output captured from the Claude desktop application. */
import type { ParseResult } from './types'
import { parseTaggedChatOutput } from './tagged-chat'

export function parseClaudeDesktopOutput(text: string): ParseResult {
  return parseTaggedChatOutput(text)
}
