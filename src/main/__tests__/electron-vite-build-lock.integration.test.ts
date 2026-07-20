import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { electronViteBuildLockDir, withElectronViteBuildLock } from './electron-vite-build-lock'

const roots: string[] = []

function root(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'offgrid-build-lock-'))
  roots.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of roots.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

describe('electron-vite build lock integration', () => {
  it('serializes concurrent builders through the real filesystem lock', async () => {
    const repository = root()
    const order: string[] = []
    let releaseFirst!: () => void
    const first = withElectronViteBuildLock(
      repository,
      async () => {
        order.push('first:start')
        await new Promise<void>((resolve) => {
          releaseFirst = resolve
        })
        order.push('first:end')
      },
      { pollMs: 5 }
    )
    while (!releaseFirst) await new Promise((resolve) => setImmediate(resolve))

    const second = withElectronViteBuildLock(
      repository,
      async () => {
        order.push('second:start')
      },
      { pollMs: 5 }
    )
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(order).toEqual(['first:start'])

    releaseFirst()
    await Promise.all([first, second])
    expect(order).toEqual(['first:start', 'first:end', 'second:start'])
  })

  it('recovers an explicitly stale lock', async () => {
    const repository = root()
    const lockDir = electronViteBuildLockDir(repository)
    fs.mkdirSync(lockDir, { recursive: true })
    const old = new Date(Date.now() - 60_000)
    fs.utimesSync(lockDir, old, old)

    const result = await withElectronViteBuildLock(repository, async () => 'built', {
      staleMs: 1_000
    })

    expect(result).toBe('built')
    expect(fs.existsSync(lockDir)).toBe(false)
  })

  it('times out while a live builder owns the lock', async () => {
    const repository = root()
    const lockDir = electronViteBuildLockDir(repository)
    fs.mkdirSync(lockDir, { recursive: true })

    await expect(
      withElectronViteBuildLock(repository, async () => {}, {
        timeoutMs: 15,
        staleMs: 60_000,
        pollMs: 5
      })
    ).rejects.toThrow('Timed out waiting 15ms for electron-vite build lock')
  })
})
