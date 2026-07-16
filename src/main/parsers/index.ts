/**
 * Parser module index
 *
 * Re-exports all platform-specific parsers for clean imports.
 * Each parser is completely independent - no shared logic between them.
 */

export { parseClaudeDesktopOutput } from './claude-desktop'
export { parseClaudeWebOutput } from './claude-web'
export { parseChatGPTOutput } from './chatgpt'
export { parseGeminiOutput } from './gemini'
