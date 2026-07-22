// @vitest-environment jsdom

/**
 * Checklist #16 at the rendered voice-note seam. Browser microphone access and
 * Electron's System Settings handoff are the only controlled boundaries; the
 * production permission owner and MemoryChat recovery behavior remain real.
 */
import { cleanup, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ChatBoundary, installBoundary, renderChat, send } from './harness/chat-boundary'

class RecorderBoundary {
  state: RecordingState = 'inactive'
  ondataavailable: ((event: BlobEvent) => void) | null = null
  onstop: (() => void) | null = null

  constructor(_stream: MediaStream) {}

  start(): void {
    this.state = 'recording'
  }

  stop(): void {
    this.state = 'inactive'
    this.onstop?.()
  }
}

describe('<MemoryChat/> microphone permission recovery', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(Element.prototype as unknown as { scrollIntoView(): void }).scrollIntoView = () => {}
    globalThis.requestAnimationFrame = (callback: FrameRequestCallback): number => {
      callback(0)
      return 1
    }
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('explains denial, keeps text chat usable, opens Settings, and retries without remounting', async () => {
    const stopTrack = vi.fn()
    const stream = { getTracks: () => [{ stop: stopTrack }] } as unknown as MediaStream
    const getUserMedia = vi
      .fn()
      .mockRejectedValueOnce(new DOMException('Permission denied', 'NotAllowedError'))
      .mockResolvedValue(stream)
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia }
    })
    vi.stubGlobal('MediaRecorder', RecorderBoundary)

    const boundary = new ChatBoundary()
    const openMicrophoneSettings = vi.fn(async () => true)
    Object.assign(boundary.api, { openMicrophoneSettings })
    installBoundary(boundary)
    const user = userEvent.setup()
    renderChat({ conversationId: 'conversation-a' })

    await user.click(await screen.findByRole('button', { name: 'Record voice' }))

    expect((await screen.findByRole('alert')).textContent).toContain(
      'Microphone access is off. Allow Off Grid AI Desktop in System Settings, then try again.'
    )
    await user.click(screen.getByRole('button', { name: 'Open System Settings' }))
    expect(openMicrophoneSettings).toHaveBeenCalledOnce()

    await send('Text chat remains available', user)
    await waitFor(() => expect(boundary.calls).toHaveLength(1))
    boundary.resolve(0, 'Text path still works')
    expect(await screen.findByText('Text path still works')).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Record voice' }))
    expect(await screen.findByRole('button', { name: 'Stop recording' })).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(getUserMedia).toHaveBeenCalledTimes(2)

    await user.click(screen.getByRole('button', { name: 'Stop recording' }))
    await waitFor(() => expect(stopTrack).toHaveBeenCalledOnce())
  })
})
