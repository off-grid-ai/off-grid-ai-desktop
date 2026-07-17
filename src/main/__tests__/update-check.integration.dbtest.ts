/**
 * Manual update checks through the production updater IPC owner.
 *
 * electron-updater is the remote/native boundary. The updater itself, its
 * listener lifecycle, explicit-download policy, and SQLite-backed preference
 * owner remain real.
 */
import { EventEmitter } from 'node:events'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const state = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>()
}))

const tempProfile = fs.mkdtempSync(path.join(os.tmpdir(), 'offgrid-manual-update-'))
const updaterEvents = new EventEmitter()
const checkForUpdates = vi.fn(async () => undefined)
const downloadUpdate = vi.fn(async () => undefined)

vi.mock('electron', () => ({
  app: {
    getPath: () => tempProfile,
    getVersion: () => '0.0.103',
    getAppPath: () => process.cwd(),
    isPackaged: true
  },
  BrowserWindow: { getAllWindows: () => [] },
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => {
      state.handlers.set(channel, handler)
    }
  },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(`encrypted:${value}`),
    decryptString: (value: Buffer) => value.toString().replace(/^encrypted:/, '')
  }
}))

vi.mock('electron-updater', () => ({
  autoUpdater: {
    autoDownload: true,
    autoInstallOnAppQuit: true,
    channel: 'latest',
    allowPrerelease: false,
    allowDowngrade: false,
    checkForUpdatesAndNotify: vi.fn(async () => undefined),
    checkForUpdates,
    downloadUpdate,
    quitAndInstall: vi.fn(),
    on: updaterEvents.on.bind(updaterEvents),
    once: updaterEvents.once.bind(updaterEvents),
    removeListener: updaterEvents.removeListener.bind(updaterEvents)
  }
}))

function handler<T>(channel: string): (...args: unknown[]) => Promise<T> {
  const registered = state.handlers.get(channel)
  expect(registered).toBeTypeOf('function')
  return (...args: unknown[]) => Promise.resolve(registered?.({}, ...args) as T)
}

beforeEach(() => {
  state.handlers.clear()
  updaterEvents.removeAllListeners()
  checkForUpdates.mockClear()
  checkForUpdates.mockResolvedValue(undefined)
  downloadUpdate.mockClear()
  vi.useFakeTimers()
})

afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
})

afterAll(async () => {
  const database = await import('../database')
  database.getDB().close()
  fs.rmSync(tempProfile, { recursive: true, force: true })
})

describe('manual update check', () => {
  it('reports an available version and explicitly downloads when automatic updates are off', async () => {
    const updater = await import('../updater')
    updater.startAutoUpdates()
    expect(await handler<boolean>('update:set-auto')(false)).toBe(false)

    const result = handler<{ status: string; version: string }>('update:check')()
    updaterEvents.emit('update-available', { version: '0.0.104' })

    await expect(result).resolves.toEqual({ status: 'available', version: '0.0.104' })
    expect(downloadUpdate).toHaveBeenCalledOnce()
    expect(checkForUpdates).toHaveBeenCalledOnce()
    expect(updaterEvents.listenerCount('update-available')).toBe(1)
    expect(updaterEvents.listenerCount('update-not-available')).toBe(1)
  })

  it('reports the installed version when stable is current and releases one-shot listeners', async () => {
    const updater = await import('../updater')
    updater.startAutoUpdates()

    const result = handler<{ status: string; version: string }>('update:check')()
    updaterEvents.emit('update-not-available')

    await expect(result).resolves.toEqual({ status: 'not-available', version: '0.0.103' })
    expect(updaterEvents.listenerCount('update-available')).toBe(1)
    expect(updaterEvents.listenerCount('update-not-available')).toBe(1)
  })

  it('returns a useful boundary failure and remains usable for the next check', async () => {
    const updater = await import('../updater')
    updater.startAutoUpdates()

    const failed = handler<{ status: string; error: string }>('update:check')()
    updaterEvents.emit('error', new Error('release feed unavailable'))
    await expect(failed).resolves.toEqual({
      status: 'error',
      error: 'release feed unavailable'
    })

    const retry = handler<{ status: string; version: string }>('update:check')()
    updaterEvents.emit('update-not-available')
    await expect(retry).resolves.toEqual({ status: 'not-available', version: '0.0.103' })
    expect(checkForUpdates).toHaveBeenCalledTimes(2)
  })

  it('times out clearly, cleans up, and allows an immediate retry', async () => {
    const updater = await import('../updater')
    updater.startAutoUpdates()

    const timedOut = updater.checkForUpdates(25)
    await vi.advanceTimersByTimeAsync(25)
    await expect(timedOut).resolves.toEqual({ status: 'error', error: 'Update check timed out' })

    const retry = handler<{ status: string; version: string }>('update:check')()
    updaterEvents.emit('update-not-available')
    await expect(retry).resolves.toEqual({ status: 'not-available', version: '0.0.103' })
  })
})
