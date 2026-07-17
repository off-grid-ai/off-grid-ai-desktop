import { afterAll, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

type Handler = (event: unknown, ...args: unknown[]) => unknown
const handlers = new Map<string, Handler>()
const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'offgrid-rag-ipc-project-'))

vi.mock('electron', () => ({
  app: { getPath: () => TMP_DIR, isPackaged: false, getAppPath: () => process.cwd() },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (value: string) => Buffer.from(value),
    decryptString: (value: Buffer) => value.toString()
  },
  ipcMain: { handle: (channel: string, handler: Handler) => handlers.set(channel, handler) },
  dialog: { showOpenDialog: vi.fn() },
  BrowserWindow: { fromWebContents: () => undefined }
}))

import { setupRagIPC } from '../rag-ipc'
import { listProjects } from '../rag/store'

afterAll(() => {
  fs.rmSync(TMP_DIR, { recursive: true, force: true })
})

describe('projects:create IPC', () => {
  it('creates durable projects with unique opaque identifiers', () => {
    setupRagIPC()
    const create = handlers.get('projects:create')
    expect(create).toBeTypeOf('function')

    const first = create!(undefined, { name: 'First project' }) as string
    const second = create!(undefined, { name: 'Second project' }) as string

    expect(first).toMatch(/^proj_[0-9a-f-]{36}$/)
    expect(second).toMatch(/^proj_[0-9a-f-]{36}$/)
    expect(second).not.toBe(first)
    expect(listProjects().map(({ id, name }) => ({ id, name }))).toEqual(
      expect.arrayContaining([
        { id: first, name: 'First project' },
        { id: second, name: 'Second project' }
      ])
    )
  })
})
