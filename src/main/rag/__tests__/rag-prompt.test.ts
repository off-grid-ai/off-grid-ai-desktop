/**
 * Unit tests for the pure project-chat prompt assembly extracted from rag/index.ts:
 * buildProjectPrompt (filter(Boolean) drops blank parts) + formatHistory (last 8).
 * No RagService/llm/store — pure import-and-assert.
 */
import { describe, it, expect } from 'vitest'
import { buildProjectPrompt, formatHistory } from '../prompt'

describe('formatHistory — last 8 turns as User:/Assistant: lines', () => {
  it('renders roles: assistant -> "Assistant:", anything else -> "User:"', () => {
    const out = formatHistory([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' }
    ])
    expect(out).toBe('User: hi\nAssistant: hello')
  })

  it('treats any non-assistant role as User', () => {
    expect(formatHistory([{ role: 'system', content: 'x' }])).toBe('User: x')
  })

  it('truncates to the last 8 messages', () => {
    const msgs = Array.from({ length: 12 }, (_, i) => ({ role: 'user', content: `m${i}` }))
    const out = formatHistory(msgs)
    const lines = out.split('\n')
    expect(lines).toHaveLength(8)
    expect(lines[0]).toBe('User: m4') // messages 4..11 kept
    expect(lines[7]).toBe('User: m11')
  })

  it('an empty thread yields an empty string', () => {
    expect(formatHistory([])).toBe('')
  })
})

describe('buildProjectPrompt — grounded prompt assembly', () => {
  it('assembles all parts joined by blank lines, ending with the Assistant cue', () => {
    const out = buildProjectPrompt({
      system: 'You are helpful.',
      context: 'CONTEXT DOC',
      history: 'User: earlier\nAssistant: reply',
      message: 'what now?'
    })
    expect(out).toBe(
      [
        'You are helpful.',
        'CONTEXT DOC',
        'Conversation so far:\nUser: earlier\nAssistant: reply',
        'User: what now?',
        'Assistant:'
      ].join('\n\n')
    )
  })

  it('drops an empty context block via filter(Boolean)', () => {
    const out = buildProjectPrompt({ system: 'S', context: '', history: '', message: 'q' })
    expect(out).toBe(['S', 'User: q', 'Assistant:'].join('\n\n'))
    expect(out).not.toContain('Conversation so far')
  })

  it('drops an empty history block but keeps context', () => {
    const out = buildProjectPrompt({ system: 'S', context: 'CTX', history: '', message: 'q' })
    expect(out).toBe(['S', 'CTX', 'User: q', 'Assistant:'].join('\n\n'))
  })

  it('wraps a non-empty history under the "Conversation so far:" header', () => {
    const out = buildProjectPrompt({ system: 'S', context: '', history: 'User: a', message: 'q' })
    expect(out).toContain('Conversation so far:\nUser: a')
  })

  it('always keeps the user turn and the Assistant cue', () => {
    const out = buildProjectPrompt({ system: '', context: '', history: '', message: 'only' })
    // system '' is also dropped by filter(Boolean)
    expect(out).toBe(['User: only', 'Assistant:'].join('\n\n'))
  })
})
