/**
 * Claude Web Parser
 *
 * Completely self-contained parser for Claude Web (claude.ai in browser).
 * No shared code with other parsers - changes here won't affect ChatGPT or Gemini.
 */

import type { ParseResult } from './types'

export function parseClaudeWebOutput(text: string): ParseResult {
  const messages: { role: string; content: string; timestamp?: string }[] = []
  const lines = text.split('\n')

  let currentRole = ''
  let currentContent: string[] = []
  let lastTimestamp = ''
  let chatTitle: string | undefined
  let windowTitle: string | undefined
  let browserUrl: string | undefined

  const commitCurrent = () => {
    if (currentRole && currentContent.length > 0) {
      messages.push({
        role: currentRole,
        content: currentContent.join('\n').trim(),
        timestamp: lastTimestamp
      })
    }
  }

  for (const line of lines) {
    const trimmed = line.trim()

    // Extract titles
    if (trimmed.startsWith('[WINDOW_TITLE]')) {
      windowTitle = trimmed.replace('[WINDOW_TITLE]', '').trim()
      continue
    }
    if (trimmed.startsWith('[BROWSER_URL]')) {
      browserUrl = trimmed.replace('[BROWSER_URL]', '').trim()
      continue
    }
    if (trimmed.startsWith('[CHAT_TITLE]')) {
      chatTitle = trimmed.replace('[CHAT_TITLE]', '').trim()
      continue
    }
    if (trimmed.startsWith('[TITLE]')) {
      // Skip generic headers/titles so they don't get appended to messages
      continue
    }

    if (trimmed.startsWith('[METADATA]')) {
      const timeStr = trimmed.replace('[METADATA]', '').trim()
      if (timeStr.match(/\d{1,2}:\d{2}/)) {
        lastTimestamp = timeStr
      }
      continue
    }

    // Detect Semantic Roles
    if (trimmed.startsWith('[USER]')) {
      const nextContent = trimmed.replace('[USER]', '').trim()
      if (currentRole === 'user') {
        if (nextContent) currentContent.push(nextContent)
      } else {
        commitCurrent()
        currentRole = 'user'
        currentContent = nextContent ? [nextContent] : []
      }
    } else if (trimmed.startsWith('[ASSISTANT]')) {
      const nextContent = trimmed.replace('[ASSISTANT]', '').trim()
      if (currentRole === 'assistant') {
        if (nextContent) currentContent.push(nextContent)
      } else {
        commitCurrent()
        currentRole = 'assistant'
        currentContent = nextContent ? [nextContent] : []
      }
    }
    // Handle continuation
    else if (currentRole) {
      const cleanLine = trimmed.replace(/^\[.*?\]/, '').trim()
      if (cleanLine) currentContent.push(cleanLine)
    }
  }

  // flush last
  commitCurrent()

  return { messages, chatTitle, windowTitle, browserUrl }
}
