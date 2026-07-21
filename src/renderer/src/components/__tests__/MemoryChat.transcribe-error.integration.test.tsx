// @vitest-environment jsdom

/**
 * A recorded voice note whose transcription FAILS must surface an error, not vanish.
 * The old onstop handler console.error-ed and returned silently — the "nothing
 * happened" bug. Real MemoryChat through the chat harness; only the mic + MediaRecorder
 * device boundary and the transcribe IPC are faked.
 */
import { cleanup, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ChatBoundary, installBoundary, renderChat } from './harness/chat-boundary'

// Emits a non-empty chunk on start so the recording isn't treated as "no audio".
class DataRecorder {
  ondataavailable: ((event: { data: Blob }) => void) | null = null
  onstop: (() => void) | null = null
  constructor(_stream: MediaStream) {}
  start(): void {
    this.ondataavailable?.({ data: new Blob(['audio-bytes'], { type: 'audio/webm' }) })
  }
  stop(): void {
    this.onstop?.()
  }
}

describe('<MemoryChat/> voice note — transcription failure is surfaced', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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

  it('shows an error banner when transcription fails, instead of silently dropping it', async () => {
    const stream = { getTracks: () => [{ stop: vi.fn() }] } as unknown as MediaStream
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: vi.fn().mockResolvedValue(stream) }
    })
    vi.stubGlobal('MediaRecorder', DataRecorder)

    const boundary = new ChatBoundary()
    Object.assign(boundary.api, {
      transcribeAudio: vi.fn().mockRejectedValue(new Error('whisper-cli failed to load'))
    })
    installBoundary(boundary)
    const user = userEvent.setup()
    renderChat({ conversationId: 'conversation-a' })

    await user.click(await screen.findByRole('button', { name: 'Record voice' }))
    await user.click(await screen.findByRole('button', { name: 'Stop recording' }))

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('Transcription failed')
  })
})
