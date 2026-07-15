// D29/D30 — "Delete all my data" completeness (real temp SQLite).
//
// Product-correct outcome (the user's view): tapping "Delete all my data" erases
// EVERY store that holds personal data. The reassurance copy says it "permanently
// erases your personal data" — so after it runs, nothing personal may survive.
//
// This is an integration test over the REAL data layer: we seed personal tables
// through their REAL insert paths (addConnector, setSecret, the real vector store),
// run the REAL deleteAllData(), and assert the terminal artifact the user cares
// about — the surviving row counts in the real DB. No mocks of our own code; the
// only fakes are the two true boundaries (Electron's userData dir + the lancedb
// native module, which deleteAllData never actually queries — it only drops its
// cached handle via resetVectors()).
//
// On HEAD this is RED: deleteAllData clears only CHAT_TABLES + MEMORY_TABLES +
// user_profile, so connectors, secrets (OAuth tokens!), and the RAG knowledge base
// (rag_documents/rag_chunks) all survive a "full erase" — a privacy failure and a
// broken promise. The fix routes every personal store through one registry.

import { describe, it, expect, afterAll, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'offgrid-delall-'));

vi.mock('electron', () => ({
  app: { getPath: () => TMP_DIR, isPackaged: false, getAppPath: () => process.cwd() },
  // Report OS encryption AVAILABLE (identity codec) so setSecret actually stores a
  // row — its refuse-when-unavailable path is correct production behavior, not the
  // bug under test. The at-rest codec is independent of the SQLite key.
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (s: string) => Buffer.from(s),
    decryptString: (b: Buffer) => b.toString(),
  },
}));

// lancedb is a native vector DB — a true external boundary. deleteAllData never
// issues a query against it (it only nulls the cached handle via resetVectors),
// so a bare stub is enough to let vectors.ts import in-process.
vi.mock('@lancedb/lancedb', () => ({ connect: async () => ({}) }));

import * as dbmod from '../database';
import { deleteAllData } from '../data-privacy';
import { addConnector } from '../mcp';
import { setSecret } from '../secrets';
import { desktopVectorStore } from '../rag/store';

const count = (t: string): number =>
  (dbmod.getDB().prepare(`SELECT COUNT(*) AS c FROM ${t}`).get() as { c: number }).c;

afterAll(() => {
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch { /* best effort */ }
});

describe('deleteAllData — erases EVERY core personal store (D29/D30)', () => {
  it('leaves no connectors, secrets, or RAG knowledge base behind', async () => {
    // Seed via the REAL insert paths (each ensures its own schema).
    addConnector({ name: 'Notion', transport: 'http', url: 'https://mcp.notion.com' });
    setSecret('connector:1:oauth:tokens', JSON.stringify({ access_token: 'live-token-abc' }));
    const docId = await desktopVectorStore.addDocument({
      projectId: 'p1', name: 'roadmap.md', path: '/tmp/roadmap.md', size: 100, kind: 'text',
    });
    await desktopVectorStore.addChunks(docId, [{ content: 'secret plan', position: 0 }], [[0.1, 0.2, 0.3]]);

    // Control: a chat conversation, which delete-all ALREADY clears today — proves
    // the harness is sound and deleteAllData actually ran end-to-end.
    dbmod.createRagConversation('c1', 'A chat', null);

    // Precondition: everything is really there.
    expect(count('connectors')).toBeGreaterThan(0);
    expect(count('secrets')).toBeGreaterThan(0);
    expect(count('rag_documents')).toBeGreaterThan(0);
    expect(count('rag_chunks')).toBeGreaterThan(0);
    expect(count('rag_conversations')).toBeGreaterThan(0);

    deleteAllData();

    // Terminal artifact: the user's personal data is GONE.
    expect(count('rag_conversations')).toBe(0); // control — already worked
    expect(count('connectors')).toBe(0);        // D30 — was surviving
    expect(count('secrets')).toBe(0);            // D30 — OAuth tokens were surviving
    expect(count('rag_documents')).toBe(0);      // D29 — knowledge base was surviving
    expect(count('rag_chunks')).toBe(0);         // D29 — knowledge base was surviving
  });
});
