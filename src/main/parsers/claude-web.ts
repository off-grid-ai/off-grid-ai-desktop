/** Parse tagged OCR output captured from claude.ai in a browser. */
import type { ParseResult } from './types'
import { parseTaggedChatOutput } from './tagged-chat'

export function parseClaudeWebOutput(text: string): ParseResult {
  return parseTaggedChatOutput(text)
}
