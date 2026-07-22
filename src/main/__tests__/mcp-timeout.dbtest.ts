/**
 * Real connector discovery across the SQLite -> MCP transport -> extension seam.
 * Only the external MCP SDK/process is controlled: one process answers and one
 * never does. Production fetchTools owns the timeout, status update, concurrency,
 * and healthy-schema preservation asserted here.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'offgrid-mcp-timeout-'))

vi.mock('electron', () => ({
  app: { getPath: () => TMP_DIR, isPackaged: false, getAppPath: () => process.cwd() },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (value: string) => Buffer.from(value),
    decryptString: (value: Buffer) => value.toString()
  }
}))

vi.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({
  StdioClientTransport: class {
    readonly command: string

    constructor(options: { command: string }) {
      this.command = options.command
    }
  }
}))

vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: class {
    private command = ''

    async connect(transport: { command: string }): Promise<void> {
      this.command = transport.command
    }

    async listTools(): Promise<{ tools: Array<{ name: string; description: string }> }> {
      if (this.command === 'dead-mcp') return new Promise(() => {})
      return { tools: [{ name: 'read_status', description: 'Read current status' }] }
    }

    async close(): Promise<void> {}
  }
}))

import { getDB } from '../database'
import { addConnector, FETCH_TOOLS_TIMEOUT_MS, listConnectors } from '../mcp'
import { McpConnectorToolExtension } from '../tools/mcpConnectorToolExtension'

beforeEach(() => {
  listConnectors()
  getDB().exec('DELETE FROM connectors')
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

afterAll(() => {
  getDB().close()
  fs.rmSync(TMP_DIR, { recursive: true, force: true })
})

describe('MCP discovery timeout', () => {
  it('keeps healthy tools when another connector never responds', async () => {
    const healthyId = addConnector({
      name: 'Healthy',
      transport: 'stdio',
      command: 'healthy-mcp'
    })
    const deadId = addConnector({ name: 'Dead', transport: 'stdio', command: 'dead-mcp' })

    const discovery = new McpConnectorToolExtension().schemas()
    await vi.advanceTimersByTimeAsync(FETCH_TOOLS_TIMEOUT_MS + 1)
    const schemas = discovery as Promise<Array<{ function: { name: string } }>>

    await expect(schemas).resolves.toEqual([
      expect.objectContaining({
        function: expect.objectContaining({ name: `mcp__${healthyId}__read_status` })
      })
    ])
    expect(listConnectors().find((connector) => connector.id === deadId)).toMatchObject({
      status: 'error',
      status_detail: 'listing tools for Dead timed out'
    })
  })
})
