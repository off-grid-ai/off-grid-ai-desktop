import type { ParseResult } from './types'
import { createNoiseFilter, createRoleLabelDetector, parseTaggedChatOutput } from './tagged-chat'

const isNoiseLine = createNoiseFilter({
  literals: [
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
  ],
  prefixes: ['gemini.google.com/', 'bard.google.com/']
})

const detectRoleLabel = createRoleLabelDetector([
  { label: 'you', role: 'user' },
  { label: 'you:', role: 'user' },
  { label: 'user:', role: 'user' },
  { label: 'gemini', role: 'assistant' },
  { label: 'gemini:', role: 'assistant' },
  { label: 'assistant:', role: 'assistant' }
])

export function parseGeminiOutput(text: string): ParseResult {
  return parseTaggedChatOutput(text, { detectRoleLabel, isNoiseLine })
}
