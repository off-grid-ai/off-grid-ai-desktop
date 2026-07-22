// @vitest-environment jsdom

// Integration: tool calls persist on an assistant message and are readable. A message
// loaded with context.toolCalls renders each call as a CLICKABLE chip; clicking opens
// the full result (previously truncated to 32 chars with the full text only on hover).
// Real MemoryChat through the chat-boundary harness; only the window.api seam is faked.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ChatBoundary, installBoundary, renderChat } from './harness/chat-boundary'

const LONG_RESULT =
  'GitHub — off-grid-ai/OGAD: Off Grid AI Desktop, a local-first on-device AI runtime.'

describe('<MemoryChat/> tool calls — persistent + clickable', () => {
  beforeEach(() => {
    ;(Element.prototype as unknown as { scrollIntoView(): void }).scrollIntoView = () => {}
    globalThis.requestAnimationFrame = (cb: FrameRequestCallback): number => {
      cb(0)
      return 1
    }
  })
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('renders each tool call as a chip and opens its full result on click', async () => {
    const boundary = new ChatBoundary()
    // An assistant turn that already ran tools — persisted via context.toolCalls.
    boundary.messages['conversation-b'] = [
      {
        id: 1,
        role: 'assistant',
        content: 'Here is what I found.',
        context: {
          unified: [],
          toolCalls: [
            { name: 'web_search', result: LONG_RESULT },
            { name: 'read_url', result: 'Off Grid AI · GitHub page body text' }
          ]
        }
      }
    ]
    installBoundary(boundary)
    const user = userEvent.setup()
    renderChat({ conversationId: 'conversation-b' })

    // Both tool calls show as chips (truncated), so you can see WHICH tools ran.
    const chip = await screen.findByRole('button', { name: /web_search →/ })
    expect(chip.textContent).toContain('…') // truncated in the chip
    expect(await screen.findByRole('button', { name: /read_url →/ })).toBeTruthy()

    // Clicking opens the FULL result (not just the 32-char preview).
    await user.click(chip)
    expect(await screen.findByText(LONG_RESULT)).toBeTruthy()
  })

  it('does not render a chip for search_memory (shown as source cards instead)', async () => {
    const boundary = new ChatBoundary()
    boundary.messages['conversation-b'] = [
      {
        id: 1,
        role: 'assistant',
        content: 'Answer.',
        context: { unified: [], toolCalls: [{ name: 'search_memory', result: 'memory hits' }] }
      }
    ]
    installBoundary(boundary)
    renderChat({ conversationId: 'conversation-b' })

    await screen.findByText('Answer.')
    expect(screen.queryByRole('button', { name: /search_memory →/ })).toBeNull()
  })
})
