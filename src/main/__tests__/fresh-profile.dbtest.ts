/**
 * RELEASE_TEST_CHECKLIST #3 - a brand-new profile contains no synthetic or prior user state.
 * The Electron profile/Keychain are controlled native boundaries; all state reads use production
 * repositories against a real disposable SQLite file.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'offgrid-fresh-profile-'))

vi.mock('electron', () => ({
  app: { getPath: () => profile },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (value: string) => Buffer.from(value),
    decryptString: (value: Buffer) => value.toString()
  }
}))

import {
  getAllChatSummaries,
  getChatSessions,
  getDashboardStats,
  getDB,
  getEntities,
  getMasterMemory,
  getRagConversations,
  getUserProfile
} from '../database'
import { listProjects } from '../rag/store'

afterAll(() => {
  if (getDB().open) getDB().close()
  fs.rmSync(profile, { recursive: true, force: true })
})

describe('fresh profile integration', () => {
  it('starts with no chats, projects, memories, entities, summaries, or identity (#3)', () => {
    expect(fs.readdirSync(profile)).toEqual([])

    expect(getRagConversations()).toEqual([])
    expect(listProjects()).toEqual([])
    expect(getChatSessions()).toEqual([])
    expect(getEntities()).toEqual([])
    expect(getAllChatSummaries()).toEqual([])
    expect(getUserProfile()).toBeNull()
    expect(getMasterMemory()).toEqual({ content: null, updated_at: null })
    const stats = getDashboardStats()
    expect(stats).toEqual(
      expect.objectContaining({
        totalChats: 0,
        totalMemories: 0,
        totalEntities: 0,
        totalRelationships: 0,
        totalMessages: 0,
        totalFacts: 0,
        recentChats: [],
        recentMemories: [],
        topEntities: [],
        entityTypeCounts: [],
        appDistribution: []
      })
    )
    expect(stats.activityByDay).toHaveLength(14)
    expect(stats.activityByDay.every(({ chats, memories }) => chats === 0 && memories === 0)).toBe(
      true
    )
  })
})
