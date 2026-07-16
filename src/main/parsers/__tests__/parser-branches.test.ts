// Branch-coverage tests for the four chat-capture parsers. parser.test.ts covers
// the happy path; this file drives the branches it leaves untouched - METADATA
// timestamps, [TITLE] skips, continuation lines, empty tags, consecutive same-role
// tags, the inline role-label detector (exact match vs "label + remainder"), and
// each parser's noise-literal / URL-prefix filtering. One case per branch/path.
import { describe, it, expect } from 'vitest'
import {
  parseClaudeDesktopOutput,
  parseClaudeWebOutput,
  parseChatGPTOutput,
  parseGeminiOutput
} from '../index'

// The four parsers share the same tag-driven skeleton (titles / METADATA / [USER] /
// [ASSISTANT] / continuation). These cases must hold for every one of them, so we
// run them across all four to exercise each parser's copy of that skeleton.
const tagParsers: Array<[string, (t: string) => ReturnType<typeof parseClaudeDesktopOutput>]> = [
  ['claude-desktop', parseClaudeDesktopOutput],
  ['claude-web', parseClaudeWebOutput],
  ['chatgpt', parseChatGPTOutput],
  ['gemini', parseGeminiOutput]
]

describe.each(tagParsers)('shared tag skeleton: %s', (_name, parse) => {
  it('captures a [METADATA] timestamp that matches H:MM and attaches it to the message', () => {
    const r = parse(`[METADATA] 10:42\n[USER] hi there`)
    expect(r.messages).toHaveLength(1)
    expect(r.messages[0]!.timestamp).toBe('10:42')
  })

  it('ignores a [METADATA] line with no time pattern (timestamp stays empty)', () => {
    const r = parse(`[METADATA] no time here\n[USER] hi there`)
    expect(r.messages[0]!.timestamp).toBe('')
  })

  it('skips a generic [TITLE] line without emitting a message', () => {
    const r = parse(`[TITLE] Some Section Header\n[USER] real question`)
    expect(r.messages).toHaveLength(1)
    expect(r.messages[0]!.content).toBe('real question')
  })

  it('appends a continuation line (no tag) to the current role', () => {
    const r = parse(`[ASSISTANT] first line\nsecond line`)
    expect(r.messages).toHaveLength(1)
    expect(r.messages[0]!.content).toBe('first line\nsecond line')
  })

  it('drops a leading orphan continuation line when no role is active yet', () => {
    const r = parse(`orphan text before any role\n[USER] question`)
    expect(r.messages).toHaveLength(1)
    expect(r.messages[0]!.content).toBe('question')
  })

  it('strips a bracket tag prefix off a continuation line', () => {
    const r = parse(`[USER] question\n[IGNORED] continued body`)
    expect(r.messages[0]!.content).toBe('question\ncontinued body')
  })

  it('starts a fresh message with an empty body when a [USER] tag has no inline content', () => {
    const r = parse(`[ASSISTANT] answer\n[USER]\nfollow up`)
    const users = r.messages.filter((m) => m.role === 'user')
    expect(users).toHaveLength(1)
    expect(users[0]!.content).toBe('follow up')
  })

  it('appends inline content to the same role across repeated [USER] tags', () => {
    const r = parse(`[USER] one\n[USER] two`)
    expect(r.messages).toHaveLength(1)
    expect(r.messages[0]!.content).toBe('one\ntwo')
  })

  it('appends inline content to the same role across repeated [ASSISTANT] tags', () => {
    const r = parse(`[ASSISTANT] a\n[ASSISTANT] b`)
    expect(r.messages).toHaveLength(1)
    expect(r.messages[0]!.content).toBe('a\nb')
  })

  it('does not push an empty continuation of the same role', () => {
    // Second [USER] tag with no content and role already user -> nothing appended.
    const r = parse(`[USER] only\n[USER]`)
    expect(r.messages).toHaveLength(1)
    expect(r.messages[0]!.content).toBe('only')
  })

  it('extracts window title, chat title, and browser url tags', () => {
    const r = parse(`[WINDOW_TITLE] W\n[BROWSER_URL] example.com/x\n[CHAT_TITLE] C\n[USER] q`)
    expect(r.windowTitle).toBe('W')
    expect(r.browserUrl).toBe('example.com/x')
    expect(r.chatTitle).toBe('C')
  })
})

describe('ChatGPT inline role-label detection + noise', () => {
  it('detects a bare "ChatGPT said:" label (exact match, no remainder)', () => {
    const r = parseChatGPTOutput(`You said: question\nChatGPT said:\nthe answer body`)
    expect(r.messages.map((m) => m.role)).toEqual(['user', 'assistant'])
    expect(r.messages[1]!.content).toBe('the answer body')
  })

  it('captures the remainder after a "You said: " label on the same line', () => {
    const r = parseChatGPTOutput(`You said: inline question`)
    expect(r.messages[0]).toMatchObject({ role: 'user', content: 'inline question' })
  })

  it('drops a role-label remainder that is itself pure noise', () => {
    // "you: new chat" -> role user, remainder "new chat" is a noise literal -> dropped.
    const r = parseChatGPTOutput(`you: new chat`)
    expect(r.messages).toHaveLength(0)
  })

  it('filters a "chatgpt <digits>" model-header line as noise', () => {
    const r = parseChatGPTOutput(`[USER] chatgpt 4o\n[USER] real`)
    expect(r.messages).toHaveLength(1)
    expect(r.messages[0]!.content).toBe('real')
  })

  it('filters lines that start with the chatgpt.com / chat.openai.com hosts', () => {
    const r = parseChatGPTOutput(
      `[USER] chatgpt.com/c/abc\n[USER] chat.openai.com/c/def\n[USER] kept`
    )
    expect(r.messages).toHaveLength(1)
    expect(r.messages[0]!.content).toBe('kept')
  })

  it('recognises the "assistant:" label with a remainder', () => {
    const r = parseChatGPTOutput(`assistant: hello from assistant`)
    expect(r.messages[0]).toMatchObject({ role: 'assistant', content: 'hello from assistant' })
  })
})

describe('Gemini inline role-label detection + noise', () => {
  it('detects a bare "Gemini" label as assistant (exact match)', () => {
    const r = parseGeminiOutput(`You question here\nGemini\nassistant reply`)
    expect(r.messages.map((m) => m.role)).toEqual(['user', 'assistant'])
    expect(r.messages[1]!.content).toBe('assistant reply')
  })

  it('captures the remainder after a "you " label', () => {
    const r = parseGeminiOutput(`you asked something`)
    expect(r.messages[0]).toMatchObject({ role: 'user', content: 'asked something' })
  })

  it('filters lines starting with the gemini / bard google hosts', () => {
    const r = parseGeminiOutput(
      `[ASSISTANT] gemini.google.com/app/1\n[ASSISTANT] bard.google.com/x\n[ASSISTANT] kept`
    )
    expect(r.messages).toHaveLength(1)
    expect(r.messages[0]!.content).toBe('kept')
  })

  it('drops a role-label remainder that is pure Gemini noise', () => {
    const r = parseGeminiOutput(`you show thinking`)
    expect(r.messages).toHaveLength(0)
  })

  it('filters a Gemini UI-chrome literal on a continuation line', () => {
    // "extensions"/"feedback" are UI-chrome noise literals that are NOT role-label
    // prefixes, so they reach the continuation noise filter and are stripped.
    const r = parseGeminiOutput(`[ASSISTANT] real answer\nextensions\nfeedback`)
    expect(r.messages).toHaveLength(1)
    expect(r.messages[0]!.content).toBe('real answer')
  })
})

describe('empty / whitespace input', () => {
  it.each(tagParsers)('%s returns no messages for empty input', (_n, parse) => {
    expect(parse('').messages).toHaveLength(0)
  })
})
