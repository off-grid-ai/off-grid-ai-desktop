/** Connector deletion across the real encrypted database and secret repository. */
import { afterAll, describe, expect, it, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'offgrid-connector-delete-'))

vi.mock('electron', () => ({
  app: { getPath: () => TMP_DIR, isPackaged: false, getAppPath: () => process.cwd() },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(`encrypted:${value}`),
    decryptString: (value: Buffer) => value.toString().replace(/^encrypted:/, '')
  }
}))

afterAll(() => {
  fs.rmSync(TMP_DIR, { recursive: true, force: true })
})

describe('connector removal', () => {
  it('atomically removes every owned secret and stays deleted after reopen', async () => {
    const mcp = await import('../mcp')
    const secrets = await import('../secrets')
    const oauth = await import('../mcp-oauth')
    const database = await import('../database')

    const removedId = mcp.addConnector({
      name: 'Removed',
      transport: 'http',
      url: 'https://removed.example'
    })
    const keptId = mcp.addConnector({
      name: 'Kept',
      transport: 'http',
      url: 'https://kept.example'
    })

    const removedKeys = [
      `connector:${removedId}:oauth:tokens`,
      `connector:${removedId}:oauth:client`,
      `connector:${removedId}:oauth:verifier`,
      `connector:${removedId}:API_KEY`
    ]
    for (const key of removedKeys) expect(secrets.setSecret(key, `value-for-${key}`)).toBe(true)
    expect(secrets.setSecret(`connector:${keptId}:oauth:tokens`, 'keep-token')).toBe(true)
    expect(secrets.setSecret('unrelated:secret', 'keep-unrelated')).toBe(true)

    mcp.removeConnector(removedId)

    expect(mcp.listConnectors().map((connector) => connector.id)).toEqual([keptId])
    expect(secrets.listSecretKeys()).toEqual([
      `connector:${keptId}:oauth:tokens`,
      'unrelated:secret'
    ])
    expect(oauth.hasOAuthTokens(removedId)).toBe(false)

    database.getDB().close()
    vi.resetModules()

    const reopenedMcp = await import('../mcp')
    const reopenedSecrets = await import('../secrets')
    const reopenedOauth = await import('../mcp-oauth')
    const reopenedDatabase = await import('../database')

    expect(reopenedMcp.listConnectors().map((connector) => connector.id)).toEqual([keptId])
    expect(reopenedSecrets.listSecretKeys()).toEqual([
      `connector:${keptId}:oauth:tokens`,
      'unrelated:secret'
    ])
    expect(reopenedOauth.hasOAuthTokens(removedId)).toBe(false)
    expect(reopenedSecrets.getSecret(`connector:${keptId}:oauth:tokens`)).toBe('keep-token')
    reopenedDatabase.getDB().close()
  })
})
