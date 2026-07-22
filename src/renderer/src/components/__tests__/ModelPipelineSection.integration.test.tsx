// @vitest-environment jsdom

/**
 * The user-facing pipeline controls through the REAL section component. Only the
 * Electron api bridge is faked (a true boundary), backed by an in-memory config so
 * a toggle round-trips exactly like the IPC does: flip the switch → queueConfigSet
 * is called with the patch → the persisted config (and the switch) reflect it.
 * Also asserts the live activity indicator renders running/queued jobs.
 */
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, beforeEach } from 'vitest'

interface Cfg {
  enabled: boolean
  tier1Coexists: boolean
}
let cfg: Cfg
let state: { running: { label: string; tier: number }[]; queued: { label: string; tier: number }[] }
const setCalls: Array<Partial<Cfg>> = []

function installApi(): void {
  const api = {
    queueConfigGet: async (): Promise<Cfg> => ({ ...cfg }),
    queueConfigSet: async (patch: Partial<Cfg>): Promise<Cfg> => {
      setCalls.push(patch)
      cfg = { ...cfg, ...patch }
      return { ...cfg }
    },
    queueState: async (): Promise<typeof state> => state
  }
  ;(window as unknown as { api: typeof api }).api = api
}

describe('<ModelPipelineSection/> — user controls for the shared pipeline', () => {
  beforeEach(() => {
    cfg = { enabled: true, tier1Coexists: true }
    state = { running: [], queued: [] }
    setCalls.length = 0
  })
  afterEach(() => cleanup())

  it('reflects the persisted config and toggling a control writes it back', async () => {
    installApi()
    const { ModelPipelineSection } = await import('../Settings')
    const user = userEvent.setup()
    render(<ModelPipelineSection />)

    const pipeline = await screen.findByRole('switch', { name: 'Prioritized model pipeline' })
    await waitFor(() => expect(pipeline.getAttribute('aria-checked')).toBe('true'))

    // Turn the prioritized pipeline OFF → the patch is written and the switch flips.
    await user.click(pipeline)
    expect(setCalls).toContainEqual({ enabled: false })
    await waitFor(() => expect(pipeline.getAttribute('aria-checked')).toBe('false'))
  })

  it('toggles "keep speech responsive" independently (tier-1 coexist)', async () => {
    installApi()
    const { ModelPipelineSection } = await import('../Settings')
    const user = userEvent.setup()
    render(<ModelPipelineSection />)

    const speech = await screen.findByRole('switch', { name: 'Keep speech responsive' })
    await user.click(speech)
    expect(setCalls).toContainEqual({ tier1Coexists: false })
  })

  it('shows live activity — running jobs highlighted, queued labelled, else idle', async () => {
    state = { running: [{ label: 'chat', tier: 2 }], queued: [{ label: 'capture', tier: 3 }] }
    installApi()
    const { ModelPipelineSection } = await import('../Settings')
    render(<ModelPipelineSection />)

    expect(await screen.findByText('chat')).toBeTruthy()
    expect(await screen.findByText(/capture · queued/)).toBeTruthy()
  })
})
