// @vitest-environment jsdom
//
// RELEASE_TEST_CHECKLIST #71 - connector setup integration coverage.
//
// This mounts the real Integrations screen and drives the real catalog setup flow.
// Electron IPC and the remote MCP server cannot run in jsdom, so one stateful
// boundary stands in for that external seam. No Off Grid component, catalog,
// parser, repository, or setup orchestration is mocked.

import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

interface ConnectorRow {
  id: number
  name: string
  transport: 'stdio' | 'http'
  command: string | null
  args: string | null
  url: string | null
  enabled: number
  status: string
  status_detail: string | null
  tools: string | null
  last_synced: number | null
  synced_count: number | null
}

class ReachableConnectorBoundary {
  private rows: ConnectorRow[] = []
  private nextId = 1

  readonly api = {
    mcpList: vi.fn(async () => this.rows.map((row) => ({ ...row }))),
    mcpAdd: vi.fn(
      async (input: {
        name: string
        transport: 'stdio' | 'http'
        command?: string
        args?: string[]
        url?: string
      }) => {
        const id = this.nextId++
        this.rows.push({
          id,
          name: input.name,
          transport: input.transport,
          command: input.command ?? null,
          args: input.args ? JSON.stringify(input.args) : null,
          url: input.url ?? null,
          enabled: 1,
          status: 'untested',
          status_detail: null,
          tools: null,
          last_synced: null,
          synced_count: 0
        })
        return id
      }
    ),
    mcpTest: vi.fn(async (id: number) => {
      const row = this.rows.find((item) => item.id === id)
      if (!row) return { ok: false, error: 'Connector not found' }
      row.status = 'ok'
      row.status_detail = null
      return { ok: true, tools: [] }
    }),
    mcpRemove: vi.fn(async (id: number) => {
      this.rows = this.rows.filter((item) => item.id !== id)
    }),
    secretsSet: vi.fn(async () => {}),
    mcpItems: vi.fn(async () => []),
    mcpSetEnabled: vi.fn(async () => {}),
    mcpIngest: vi.fn(async () => ({ ok: true, count: 0 }))
  }
}

function installBoundary(boundary: ReachableConnectorBoundary): void {
  ;(globalThis as unknown as { window: { api: unknown } }).window.api = boundary.api
}

describe('<ConnectorsScreen/> integration', () => {
  beforeEach(() => vi.clearAllMocks())
  afterEach(() => cleanup())

  it('adds a reachable catalog connector once and shows its truthful connected state (#71)', async () => {
    const boundary = new ReachableConnectorBoundary()
    installBoundary(boundary)
    const { ConnectorsScreen } = await import('../ConnectorsScreen')
    const user = userEvent.setup()
    render(<ConnectorsScreen />)

    const notionCard = (await screen.findByText('Notion')).closest('div.flex.flex-col')
    expect(notionCard).not.toBeNull()
    await user.click(within(notionCard as HTMLElement).getByRole('button', { name: /connect/i }))

    await waitFor(() => {
      expect(screen.getAllByText('Notion')).toHaveLength(1)
      const connectedRow = screen.getByText('Notion').closest('button')
      expect(connectedRow).not.toBeNull()
      expect(within(connectedRow as HTMLElement).getByText('connected')).not.toBeNull()
    })
    expect(screen.queryByText('not tested')).toBeNull()
  })
})
