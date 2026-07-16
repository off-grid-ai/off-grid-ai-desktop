/**
 * Branch coverage for the Claude Desktop parser. parser.test.ts covers the happy path
 * (titles, user/assistant grouping, empty input); this file targets the branches that
 * test does not: BROWSER_URL, the [TITLE] skip, METADATA timestamp match vs non-match,
 * continuation-line bracket stripping, and the "commit only non-empty content" guard.
 * One case per branch/condition.
 */
import { describe, it, expect } from 'vitest'
import { parseClaudeDesktopOutput } from '../claude-desktop'

describe('parseClaudeDesktopOutput — metadata branches', () => {
  it('extracts a browser URL', () => {
    const r = parseClaudeDesktopOutput('[BROWSER_URL] claude.ai/chat/xyz\n[USER] hi')
    expect(r.browserUrl).toBe('claude.ai/chat/xyz')
  })

  it('skips a generic [TITLE] line (never appended to a message)', () => {
    const r = parseClaudeDesktopOutput('[USER] question\n[TITLE] Some Header\n[ASSISTANT] answer')
    const user = r.messages.find((m) => m.role === 'user')
    expect(user?.content).toBe('question') // header not folded into the user turn
    expect(r.messages.some((m) => m.content.includes('Some Header'))).toBe(false)
  })

  it('captures a METADATA timestamp that looks like a time and attaches it to the next message', () => {
    const r = parseClaudeDesktopOutput('[METADATA] 10:42\n[USER] hello')
    expect(r.messages[0]!.timestamp).toBe('10:42')
  })

  it('ignores a METADATA value that is not a time (no timestamp set)', () => {
    const r = parseClaudeDesktopOutput('[METADATA] not-a-time\n[USER] hello')
    expect(r.messages[0]!.timestamp).toBe('') // lastTimestamp never set
  })

  it('carries the most recent timestamp forward to later messages', () => {
    const r = parseClaudeDesktopOutput('[METADATA] 09:15\n[USER] first\n[ASSISTANT] reply')
    expect(r.messages[0]!.timestamp).toBe('09:15')
    expect(r.messages[1]!.timestamp).toBe('09:15')
  })
})

describe('parseClaudeDesktopOutput — role + continuation branches', () => {
  it('appends a plain continuation line to the current message', () => {
    const r = parseClaudeDesktopOutput('[USER] line one\ncontinued line')
    expect(r.messages[0]!.content).toBe('line one\ncontinued line')
  })

  it('strips a leading [BRACKET] tag off a continuation line', () => {
    // A line starting with an unrecognized [TAG] under an open role has its tag stripped.
    const r = parseClaudeDesktopOutput('[ASSISTANT] start\n[NOTE] tail text')
    expect(r.messages[0]!.content).toBe('start\ntail text')
  })

  it('drops a continuation line that is empty after stripping its tag', () => {
    const r = parseClaudeDesktopOutput('[USER] only line\n[EMPTY]')
    expect(r.messages[0]!.content).toBe('only line')
  })

  it('ignores content before any role is opened (no currentRole)', () => {
    const r = parseClaudeDesktopOutput('stray text before any role\n[USER] real')
    expect(r.messages).toHaveLength(1)
    expect(r.messages[0]!.content).toBe('real')
  })

  it('starts a new user turn with empty content when the [USER] line has no text', () => {
    // [USER] with no inline text, then a continuation supplies the content.
    const r = parseClaudeDesktopOutput('[USER]\nthe actual question')
    expect(r.messages).toHaveLength(1)
    expect(r.messages[0]!.content).toBe('the actual question')
  })

  it('does not commit a role that never received any content', () => {
    // A bare [ASSISTANT] with nothing after it must not produce an empty message.
    const r = parseClaudeDesktopOutput('[USER] hi\n[ASSISTANT]')
    expect(r.messages).toHaveLength(1)
    expect(r.messages[0]!.role).toBe('user')
  })

  it('merges consecutive same-role turns into one message', () => {
    const r = parseClaudeDesktopOutput('[USER] part a\n[USER] part b')
    expect(r.messages).toHaveLength(1)
    expect(r.messages[0]!.content).toBe('part a\npart b')
  })

  it('returns undefined titles/url when none are present', () => {
    const r = parseClaudeDesktopOutput('[USER] hi')
    expect(r.chatTitle).toBeUndefined()
    expect(r.windowTitle).toBeUndefined()
    expect(r.browserUrl).toBeUndefined()
  })
})
