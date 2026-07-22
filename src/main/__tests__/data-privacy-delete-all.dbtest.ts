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

import { describe, it, expect, afterAll, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'offgrid-delall-'))

vi.mock('electron', () => ({
  app: { getPath: () => TMP_DIR, isPackaged: false, getAppPath: () => process.cwd() },
  // Report OS encryption AVAILABLE (identity codec) so setSecret actually stores a
  // row — its refuse-when-unavailable path is correct production behavior, not the
  // bug under test. The at-rest codec is independent of the SQLite key.
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (s: string) => Buffer.from(s),
    decryptString: (b: Buffer) => b.toString()
  }
}))

// lancedb is a native vector DB — a true external boundary. deleteAllData never
// issues a query against it (it only nulls the cached handle via resetVectors),
// so a bare stub is enough to let vectors.ts import in-process.
vi.mock('@lancedb/lancedb', () => ({ connect: async () => ({}) }))

import * as dbmod from '../database'
import { clearCategory, deleteAllData } from '../data-privacy'
import { addConnector } from '../mcp'
import { setSecret } from '../secrets'
import { createProject, desktopVectorStore } from '../rag/store'

const PERSONAL_DIRS = [
  'uploads',
  'entity-photos',
  'captures',
  'meetings',
  'generated-images',
  'artifacts-library',
  'style-thumbs',
  'lancedb'
] as const

const count = (t: string): number =>
  (dbmod.getDB().prepare(`SELECT COUNT(*) AS c FROM ${t}`).get() as { c: number }).c

afterAll(() => {
  try {
    fs.rmSync(TMP_DIR, { recursive: true, force: true })
  } catch {
    /* best effort */
  }
})

describe('deleteAllData — erases EVERY core personal store (D29/D30)', () => {
  it('erases projects, chats, memory, integrations, knowledge, and personal files only', async () => {
    // Seed via the REAL insert paths (each ensures its own schema).
    addConnector({ name: 'Notion', transport: 'http', url: 'https://mcp.notion.com' })
    setSecret('connector:1:oauth:tokens', JSON.stringify({ access_token: 'live-token-abc' }))
    createProject({ id: 'p1', name: 'Private roadmap' })
    const docId = await desktopVectorStore.addDocument({
      projectId: 'p1',
      name: 'roadmap.md',
      path: '/tmp/roadmap.md',
      size: 100,
      kind: 'text'
    })
    await desktopVectorStore.addChunks(
      docId,
      [{ content: 'secret plan', position: 0 }],
      [[0.1, 0.2, 0.3]]
    )

    // Control: a chat conversation, which delete-all ALREADY clears today — proves
    // the harness is sound and deleteAllData actually ran end-to-end.
    dbmod.createRagConversation('c1', 'A chat', null)
    dbmod.saveUserProfile({ role: 'Founder', primaryTools: ['Private tool'] })
    dbmod
      .getDB()
      .prepare('INSERT INTO memories (content, source_app) VALUES (?, ?)')
      .run('private memory', 'Notes')

    for (const dir of PERSONAL_DIRS) {
      const target = path.join(TMP_DIR, dir, 'nested')
      fs.mkdirSync(target, { recursive: true })
      fs.writeFileSync(path.join(target, 'private.txt'), `private ${dir}`)
    }

    // Models and ordinary app preferences are deliberately outside the personal-data wipe.
    const modelPath = path.join(TMP_DIR, 'models', 'keep.gguf')
    fs.mkdirSync(path.dirname(modelPath), { recursive: true })
    fs.writeFileSync(modelPath, 'model')
    dbmod.saveSetting('theme', 'dark')

    // Precondition: everything is really there.
    expect(count('connectors')).toBeGreaterThan(0)
    expect(count('secrets')).toBeGreaterThan(0)
    expect(count('rag_documents')).toBeGreaterThan(0)
    expect(count('rag_chunks')).toBeGreaterThan(0)
    expect(count('rag_conversations')).toBeGreaterThan(0)
    expect(count('projects')).toBeGreaterThan(0)
    expect(count('memories')).toBeGreaterThan(0)
    expect(count('user_profile')).toBeGreaterThan(0)

    await deleteAllData()

    // Terminal artifact: the user's personal data is GONE.
    expect(count('rag_conversations')).toBe(0) // control — already worked
    expect(count('connectors')).toBe(0) // D30 — was surviving
    expect(count('secrets')).toBe(0) // D30 — OAuth tokens were surviving
    expect(count('rag_documents')).toBe(0) // D29 — knowledge base was surviving
    expect(count('rag_chunks')).toBe(0) // D29 — knowledge base was surviving
    expect(count('projects')).toBe(0)
    expect(count('memories')).toBe(0)
    expect(count('user_profile')).toBe(0)
    for (const dir of PERSONAL_DIRS) {
      expect(fs.readdirSync(path.join(TMP_DIR, dir))).toEqual([])
    }

    expect(fs.readFileSync(modelPath, 'utf8')).toBe('model')
    expect(dbmod.getSetting('theme', '')).toBe('dark')
  })
})

describe('clearCategory — erases only the selected personal-data category', () => {
  it('clears chats and uploads without touching memory, projects, credentials, or models', async () => {
    dbmod.createRagConversation('scoped-chat', 'Scoped chat', null)
    dbmod
      .getDB()
      .prepare('INSERT INTO memories (content, source_app) VALUES (?, ?)')
      .run('keep this memory', 'Notes')
    createProject({ id: 'keep-project', name: 'Keep project' })
    addConnector({ name: 'Keep connector', transport: 'http', url: 'https://mcp.example.com' })
    setSecret('keep:oauth:tokens', JSON.stringify({ access_token: 'keep-token' }))

    const uploadPath = path.join(TMP_DIR, 'uploads', 'private.txt')
    const entityPhotoPath = path.join(TMP_DIR, 'entity-photos', 'keep.jpg')
    const modelPath = path.join(TMP_DIR, 'models', 'keep-after-scoped-delete.gguf')
    for (const file of [uploadPath, entityPhotoPath, modelPath]) {
      fs.mkdirSync(path.dirname(file), { recursive: true })
      fs.writeFileSync(file, `content for ${path.basename(file)}`)
    }

    expect(await clearCategory('chats')).toEqual({ success: true })

    expect(count('rag_conversations')).toBe(0)
    expect(fs.readdirSync(path.join(TMP_DIR, 'uploads'))).toEqual([])
    expect(count('memories')).toBeGreaterThan(0)
    expect(count('projects')).toBeGreaterThan(0)
    expect(count('connectors')).toBeGreaterThan(0)
    expect(count('secrets')).toBeGreaterThan(0)
    expect(fs.existsSync(entityPhotoPath)).toBe(true)
    expect(fs.existsSync(modelPath)).toBe(true)
  })
})
