// D17 — a connector whose background tool-load fails (expired token / server down)
// must be marked errored, not silently dropped. The chat tool loader swallowed the
// failure with `continue` and never touched the connector's status, so the UI kept
// showing it "connected" while the model quietly lost its tools.
//
// Integration over the REAL connectors DB (temp SQLite): seed a connector via the
// real addConnector, run the REAL extension schemas() with ONLY the network leaf
// faked (fetchTools throws, as an auth failure would), and assert the terminal
// artifact the UI reads — the connector's persisted status is now 'error'.

import { describe, it, expect, afterAll, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'offgrid-mcp-'));

vi.mock('electron', () => ({
  app: { getPath: () => TMP_DIR, isPackaged: false, getAppPath: () => process.cwd() },
  safeStorage: { isEncryptionAvailable: () => false, encryptString: (s: string) => Buffer.from(s), decryptString: (b: Buffer) => b.toString() },
}));

// Fake ONLY the network leaf: fetchTools reaching the MCP server. listConnectors,
// addConnector, setConnectorStatus (the DB ops the fix relies on) stay REAL.
vi.mock('../mcp', async (importOriginal) => {
  const real = await importOriginal<typeof import('../mcp')>();
  return { ...real, fetchTools: vi.fn(async () => { throw new Error('Authorization required'); }) };
});

import { addConnector, listConnectors } from '../mcp';
import { mcpConnectorToolExtension } from '../tools/mcpConnectorToolExtension';

afterAll(() => { try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch { /* best effort */ } });

describe('MCP connector tool loader marks a failed connector errored (D17)', () => {
  it('flips status to error (does not silently drop) when fetchTools fails', async () => {
    const id = addConnector({ name: 'Notion', transport: 'http', url: 'https://mcp.notion.com' });
    // Precondition: a freshly added connector is not yet errored.
    expect(listConnectors().find((c) => c.id === id)?.status).not.toBe('error');

    await mcpConnectorToolExtension.schemas(); // background load — its fetchTools rejects

    // Terminal artifact: the UI now sees the connector as needing reconnection.
    const after = listConnectors().find((c) => c.id === id);
    expect(after?.status).toBe('error');
    expect(after?.status_detail).toContain('Authorization');
  });
});
