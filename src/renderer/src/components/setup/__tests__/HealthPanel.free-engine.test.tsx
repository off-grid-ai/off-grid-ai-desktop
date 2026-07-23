// @vitest-environment jsdom
//
// UI-layer test for the "Free engine" control (Task 7). Runs with a fake window.api so it needs no
// engine and no port — it verifies the button invokes llm:unload and renders the right outcome for
// both a freed port and a still-held one. The real SIGTERM→SIGKILL teardown is proven in
// engine-teardown.test.ts; the real button→engine end-to-end runs in HealthPanel.integration.test.tsx
// (which needs :8439 free, so it's CI-only when a dev app is running).
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SystemHealthContract } from '../../../../../shared/ipc-contracts'
import { HealthPanel } from '../HealthPanel'

const HEALTH: SystemHealthContract = {
  ramGb: 16,
  activeModel: 'gemma-4-E2B',
  components: [
    { id: 'chat', label: 'Chat model (llama-server)', status: 'ready', port: 8439, canRestart: true }
  ]
}

function installApi(unload: () => Promise<{ outcome: string; portFree: boolean }>): {
  unloadCalls: number
} {
  const state = { unloadCalls: 0 }
  ;(globalThis as unknown as { window: { api: unknown } }).window.api = {
    systemHealth: async () => HEALTH,
    restartComponent: async () => ({ success: true }),
    unloadLlmEngine: async () => {
      state.unloadCalls++
      return unload()
    }
  }
  return state
}

afterEach(() => cleanup())

describe('<HealthPanel/> Free engine control', () => {
  it('invokes llm:unload and reports the port was freed', async () => {
    const api = installApi(async () => ({ outcome: 'graceful', portFree: true }))
    const user = userEvent.setup()
    render(<HealthPanel />)
    await screen.findByRole('status', { name: 'Chat model (llama-server)' })

    await user.click(screen.getByRole('button', { name: 'Free engine' }))

    expect(await screen.findByText(/port freed/i)).toBeTruthy()
    expect(api.unloadCalls).toBe(1)
  })

  it('tells the user when the engine stopped but the port is still held', async () => {
    installApi(async () => ({ outcome: 'stuck', portFree: false }))
    const user = userEvent.setup()
    render(<HealthPanel />)
    await screen.findByRole('status', { name: 'Chat model (llama-server)' })

    await user.click(screen.getByRole('button', { name: 'Free engine' }))

    expect(await screen.findByText(/still held/i)).toBeTruthy()
  })
})
