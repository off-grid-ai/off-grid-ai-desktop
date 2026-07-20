import fs from 'node:fs'
import path from 'node:path'

export interface BuildLockOptions {
  timeoutMs?: number
  staleMs?: number
  pollMs?: number
}

const DEFAULT_TIMEOUT_MS = 5 * 60_000
const DEFAULT_STALE_MS = 10 * 60_000
const DEFAULT_POLL_MS = 50

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

export function electronViteBuildLockDir(repositoryRoot: string): string {
  return path.join(repositoryRoot, 'out', '.electron-vite-build.lock')
}

/**
 * electron-vite materializes one temporary config beside electron.vite.config.ts.
 * Separate Vitest workers can otherwise replace/remove that file under each other.
 * Atomic directory creation provides one lock shared across worker processes.
 */
export async function withElectronViteBuildLock<T>(
  repositoryRoot: string,
  task: () => Promise<T>,
  options: BuildLockOptions = {}
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const staleMs = options.staleMs ?? DEFAULT_STALE_MS
  const pollMs = options.pollMs ?? DEFAULT_POLL_MS
  const lockDir = electronViteBuildLockDir(repositoryRoot)
  const deadline = Date.now() + timeoutMs
  fs.mkdirSync(path.dirname(lockDir), { recursive: true })

  while (true) {
    try {
      fs.mkdirSync(lockDir)
      fs.writeFileSync(
        path.join(lockDir, 'owner.json'),
        JSON.stringify({ pid: process.pid, acquiredAt: new Date().toISOString() })
      )
      break
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error

      try {
        const ageMs = Date.now() - fs.statSync(lockDir).mtimeMs
        if (ageMs >= staleMs) {
          fs.rmSync(lockDir, { recursive: true, force: true })
          continue
        }
      } catch (statError) {
        if ((statError as NodeJS.ErrnoException).code !== 'ENOENT') throw statError
        continue
      }

      if (Date.now() >= deadline) {
        throw new Error(`Timed out waiting ${timeoutMs}ms for electron-vite build lock: ${lockDir}`)
      }
      await delay(pollMs)
    }
  }

  try {
    return await task()
  } finally {
    fs.rmSync(lockDir, { recursive: true, force: true })
  }
}
