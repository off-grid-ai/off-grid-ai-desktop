/**
 * Gemini Parser
 *
 * Completely self-contained parser for Google Gemini (gemini.google.com in browser).
 * No shared code with other parsers - changes here won't affect Claude or ChatGPT.
 */

import type { ParseResult } from './types'

export function parseGeminiOutput(text: string): ParseResult {
  const messages: { role: string; content: string; timestamp?: string }[] = []
  const lines = text.split('\n')

  let currentRole = ''
  let currentContent: string[] = []
  let lastTimestamp = ''
  let chatTitle: string | undefined
  let windowTitle: string | undefined
  let browserUrl: string | undefined

  // Gemini-specific noise filtering
  const isNoiseLine = (value: string) => {
    const lower = value.toLowerCase()
    if (!lower) return true
    const literals = [
      'gemini',
      'chats',
      'new chat',
      'chat history',
      'history',
      'recent',
      'settings',
      'help',
      'feedback',
      'privacy',
      'terms',
      'apps',
      'extensions',
      'upload',
      'send',
      'stop',
      'regenerate',
      'share',
      'export',
      'sign in',
      'signed out',
      'gemini can make mistakes, so double-check it',
      'show thinking',
      'hide thinking',
      'improve',
      'reports',
      'critique',
      'write',
      'focus'
    ]
    if (literals.includes(lower)) return true
    if (lower.startsWith('gemini.google.com/')) return true
    if (lower.startsWith('bard.google.com/')) return true
    return false
  }

  // Gemini-specific role detection
  const detectRoleLabel = (
    value: string
  ): { role: 'user' | 'assistant'; remainder?: string } | null => {
    const lower = value.toLowerCase()
    const labels: Array<{ label: string; role: 'user' | 'assistant' }> = [
      { label: 'you', role: 'user' },
      { label: 'you:', role: 'user' },
      { label: 'user:', role: 'user' },
      { label: 'gemini', role: 'assistant' },
      { label: 'gemini:', role: 'assistant' },
      { label: 'assistant:', role: 'assistant' }
    ]

    for (const entry of labels) {
      if (lower === entry.label) {
        return { role: entry.role }
      }
      if (lower.startsWith(entry.label + ' ')) {
        const remainder = value.slice(entry.label.length).trim()
        return { role: entry.role, remainder }
      }
    }

    return null
  }

  const commitCurrent = () => {
    if (currentRole && currentContent.length > 0) {
      const content = currentContent.join('\n').trim()
      if (content && !isNoiseLine(content)) {
        messages.push({
          role: currentRole,
          content,
          timestamp: lastTimestamp
        })
      }
    }
  }

  for (const line of lines) {
    const trimmed = line.trim()
    const lineWithoutTag = trimmed.replace(/^\[.*?\]\s*/, '').trim()
    const roleLabel = detectRoleLabel(lineWithoutTag)
    if (roleLabel) {
      commitCurrent()
      currentRole = roleLabel.role
      currentContent = []
      if (roleLabel.remainder && !isNoiseLine(roleLabel.remainder)) {
        currentContent.push(roleLabel.remainder)
      }
      continue
    }

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
        if (nextContent && !isNoiseLine(nextContent)) currentContent.push(nextContent)
      } else {
        commitCurrent()
        currentRole = 'user'
        currentContent = nextContent && !isNoiseLine(nextContent) ? [nextContent] : []
      }
    } else if (trimmed.startsWith('[ASSISTANT]')) {
      const nextContent = trimmed.replace('[ASSISTANT]', '').trim()
      if (currentRole === 'assistant') {
        if (nextContent && !isNoiseLine(nextContent)) currentContent.push(nextContent)
      } else {
        commitCurrent()
        currentRole = 'assistant'
        currentContent = nextContent && !isNoiseLine(nextContent) ? [nextContent] : []
      }
    }
    // Handle continuation
    else if (currentRole) {
      const cleanLine = trimmed.replace(/^\[.*?\]/, '').trim()
      if (cleanLine && !isNoiseLine(cleanLine)) currentContent.push(cleanLine)
    }
  }

  // flush last
  commitCurrent()

  return { messages, chatTitle, windowTitle, browserUrl }
}
