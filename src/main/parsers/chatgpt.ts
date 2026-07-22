import type { ParseResult } from './types'
import { createNoiseFilter, createRoleLabelDetector, parseTaggedChatOutput } from './tagged-chat'

const isNoiseLine = createNoiseFilter({
  literals: [
    'chat history',
    'search chats',
    'images',
    'apps',
    'projects',
    'gpts',
    'explore gpts',
    'your chats',
    'new chat',
    'share',
    'skip to content',
    'settings',
    'help',
    'account',
    'upgrade',
    'plans',
    'billing',
    'log out',
    'logout',
    'chatgpt can make mistakes. check important info.',
    'cookie preferences',
    'improve',
    'reports',
    'critique',
    'write',
    'focus'
  ],
  prefixes: ['chatgpt.com/', 'chat.openai.com/'],
  patterns: [/^chatgpt\s*\d/]
})

const detectRoleLabel = createRoleLabelDetector([
  { label: 'you said:', role: 'user' },
  { label: 'you:', role: 'user' },
  { label: 'chatgpt said:', role: 'assistant' },
  { label: 'chatgpt:', role: 'assistant' },
  { label: 'assistant:', role: 'assistant' }
])

export function parseChatGPTOutput(text: string): ParseResult {
  return parseTaggedChatOutput(text, { detectRoleLabel, isNoiseLine })
}
