// @vitest-environment jsdom

/**
 * Core dictation overlay across its production event bridge and native media boundary.
 * The bridge, microphone, recorder, and AudioContext are browser/Electron boundaries;
 * the real voice API and overlay own subscription, rendering, and cleanup behavior.
 */
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DictationOverlay } from '../DictationOverlay'

type Listener = (payload: unknown) => void

class OverlayBoundary {
  readonly listeners = new Map<string, Set<Listener>>()

  readonly api = {
    proInvoke: vi.fn(async (channel: string) => {
      if (channel === 'voice:dictation:get-state') return 'idle'
      if (channel === 'voice:dictation:get-settings') {
        return { mode: 'hold', accelerator: 'Alt+Space' }
      }
      return undefined
    }),
    proOn: vi.fn((channel: string, listener: Listener) => {
      const listeners = this.listeners.get(channel) ?? new Set<Listener>()
      listeners.add(listener)
      this.listeners.set(channel, listeners)
      return () => listeners.delete(listener)
    })
  }

  emit(event: string, payload?: unknown): void {
    for (const listener of this.listeners.get(`voice:dictation:${event}`) ?? []) listener(payload)
  }
}

class RecorderBoundary {
  static instances: RecorderBoundary[] = []
  readonly mimeType = 'audio/webm'
  state: RecordingState = 'inactive'
  ondataavailable: ((event: BlobEvent) => void) | null = null
  onstop: (() => void) | null = null

  constructor(_stream: MediaStream) {
    RecorderBoundary.instances.push(this)
  }

  start(): void {
    this.state = 'recording'
  }

  stop(): void {
    this.state = 'inactive'
    this.onstop?.()
  }
}

describe('<DictationOverlay/> native lifecycle', () => {
  let boundary: OverlayBoundary
  let stopTrack: ReturnType<typeof vi.fn>
  let closeContext: ReturnType<typeof vi.fn>

  beforeEach(() => {
    boundary = new OverlayBoundary()
    ;(window as unknown as { api: typeof boundary.api }).api = boundary.api
    RecorderBoundary.instances = []
    stopTrack = vi.fn()
    closeContext = vi.fn(async () => undefined)
    const stream = {
      getTracks: () => [{ stop: stopTrack }]
    } as unknown as MediaStream
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: vi.fn(async () => stream) }
    })
    vi.stubGlobal('MediaRecorder', RecorderBoundary)
    vi.stubGlobal(
      'AudioContext',
      class {
        createAnalyser(): AnalyserNode {
          return {
            fftSize: 0,
            getByteTimeDomainData: () => {}
          } as unknown as AnalyserNode
        }

        createMediaStreamSource(): MediaStreamAudioSourceNode {
          return { connect: () => undefined } as unknown as MediaStreamAudioSourceNode
        }

        close = closeContext
      }
    )
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn(() => 1)
    )
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('shows an actionable paste-permission failure while retaining the terminal result (#101)', async () => {
    render(<DictationOverlay />)
    await waitFor(() => expect(boundary.listeners.size).toBeGreaterThan(0))

    act(() => {
      boundary.emit(
        'error',
        'Accessibility permission is required to paste. The transcript is retained on the clipboard.'
      )
    })

    expect(
      screen.getByText(
        'Accessibility permission is required to paste. The transcript is retained on the clipboard.'
      )
    ).toBeTruthy()
  })

  it('stops the recorder, microphone track, and audio context when the overlay unmounts (#106)', async () => {
    const view = render(<DictationOverlay />)
    await waitFor(() => expect(boundary.listeners.size).toBeGreaterThan(0))

    act(() => boundary.emit('begin'))
    await waitFor(() => expect(RecorderBoundary.instances).toHaveLength(1))
    expect(RecorderBoundary.instances[0]!.state).toBe('recording')

    view.unmount()

    await waitFor(() => {
      expect(RecorderBoundary.instances[0]!.state).toBe('inactive')
      expect(stopTrack).toHaveBeenCalledOnce()
      expect(closeContext).toHaveBeenCalledOnce()
    })
    expect([...boundary.listeners.values()].every((listeners) => listeners.size === 0)).toBe(true)
  })
})
