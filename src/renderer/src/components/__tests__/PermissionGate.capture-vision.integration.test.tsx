// @vitest-environment jsdom

/**
 * Pro capture readiness through the rendered shell boundary. The Electron preload is the only
 * boundary fake: a running capture pipeline with a non-vision active model must tell the user
 * what is missing and make the recovery action reachable without discovering the Models screen.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PermissionGate } from '../PermissionGate'

const MODEL_ID = 'unsloth/gemma-4-E2B-it-GGUF'
let visionStatus: Record<string, { supportsVision: boolean; projectorInstalled: boolean }>
let downloadModel: ReturnType<typeof vi.fn>
let captureStatus: { running: boolean; paused: boolean; visionReady: boolean }
let proListeners: Map<string, () => void>

beforeEach(() => {
  visionStatus = {}
  downloadModel = vi.fn(async () => ({ success: true }))
  captureStatus = { running: true, paused: false, visionReady: false }
  proListeners = new Map()
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      isPro: true,
      getPermissionStatus: async () => ({
        accessibility: true,
        screenRecording: true,
        microphone: true,
        allGranted: true
      }),
      checkModelStatus: async () => ({ downloaded: true, modelsDir: '/tmp/models' }),
      getActiveModel: async () => MODEL_ID,
      getModelVisionStatus: async () => visionStatus,
      proInvoke: async (channel: string) => {
        if (channel === 'capture:status') {
          return captureStatus
        }
        return null
      },
      proOn: (channel: string, callback: () => void) => {
        proListeners.set(channel, callback)
        return () => proListeners.delete(channel)
      },
      onModelProgress: () => () => {},
      downloadModel
    }
  })
})

afterEach(() => cleanup())

describe('<PermissionGate/> Pro capture vision recovery', () => {
  it('offers the missing projector download from the app shell', async () => {
    visionStatus = { [MODEL_ID]: { supportsVision: true, projectorInstalled: false } }
    const user = userEvent.setup()
    render(
      <PermissionGate>
        <div>App shell</div>
      </PermissionGate>
    )

    expect(await screen.findByText('Capture needs vision support')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Download vision support' }))
    expect(downloadModel).toHaveBeenCalledWith(MODEL_ID)
  })

  it('routes a text-only active model to model selection', async () => {
    const navigate = vi.fn()
    window.addEventListener('og:navigate', navigate)
    const user = userEvent.setup()
    render(
      <PermissionGate>
        <div>App shell</div>
      </PermissionGate>
    )

    expect(await screen.findByText('Capture needs a vision model')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Choose model' }))
    await waitFor(() => expect(navigate).toHaveBeenCalledOnce())
    expect((navigate.mock.calls[0]?.[0] as CustomEvent).detail).toBe('models')
    window.removeEventListener('og:navigate', navigate)
  })

  it('surfaces a new capture vision problem when the running pipeline reports a change', async () => {
    captureStatus = { running: true, paused: false, visionReady: true }
    render(
      <PermissionGate>
        <div>App shell</div>
      </PermissionGate>
    )

    await screen.findByText('App shell')
    expect(screen.queryByText('Capture needs a vision model')).toBeNull()

    captureStatus = { running: true, paused: false, visionReady: false }
    proListeners.get('capture:changed')?.()

    expect(await screen.findByText('Capture needs a vision model')).toBeTruthy()
  })
})
