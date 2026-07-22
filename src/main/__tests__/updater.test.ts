/**
 * Regression guard for the "downloaded update never installs" bug. Squirrel.Mac
 * only swaps the app bundle on a GRACEFUL quit (autoInstallOnAppQuit); a
 * force-kill (Activity Monitor, kill -9, the dev-restart path) skips it, so a
 * fully-downloaded update can sit staged forever (observed: a complete 0.0.25
 * download that never applied while the app stayed on 0.0.24).
 *
 * The fix exposes an explicit install path: main registers an `update:install`
 * IPC that calls autoUpdater.quitAndInstall(), and the renderer surfaces a
 * "Restart to update" button driven by it. updater.ts imports electron, so it
 * can't be unit-run — assert the contract by reading the source (same approach
 * as extract-prompt.test.ts).
 */
import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

const UPDATER = path.resolve(process.cwd(), 'src/main/updater.ts')
const PRELOAD = path.resolve(process.cwd(), 'src/preload/index.ts')
const INDEX = path.resolve(process.cwd(), 'src/main/index.ts')
const updaterSrc = fs.readFileSync(UPDATER, 'utf-8')
const preloadSrc = fs.readFileSync(PRELOAD, 'utf-8')
const indexSrc = fs.readFileSync(INDEX, 'utf-8')

describe('auto-update: explicit install path', () => {
  it('registers an update:install IPC handler', () => {
    expect(updaterSrc).toMatch(/ipcMain\.handle\(\s*['"]update:install['"]/)
  })

  it('drives the install via quitAndInstall (not a passive wait for quit)', () => {
    expect(updaterSrc).toMatch(/autoUpdater\.quitAndInstall\(\)/)
  })

  it('still emits update:downloaded so the renderer can prompt', () => {
    expect(updaterSrc).toMatch(/send\(\s*['"]update:downloaded['"]/)
  })

  it('persists the staged version + exposes a getter (macOS zero-window case)', () => {
    // The event only reaches windows open at download time; a window created
    // later must still be able to ask whether an update is already staged.
    expect(updaterSrc).toMatch(/stagedVersion\s*=\s*i\.version/)
    expect(updaterSrc).toMatch(/ipcMain\.handle\(\s*['"]update:staged-version['"]/)
    expect(preloadSrc).toMatch(
      /getStagedUpdateVersion:\s*\(\)\s*=>\s*ipcRenderer\.invoke\(\s*['"]update:staged-version['"]/
    )
  })

  it('preload bridges installUpdate() to the update:install channel', () => {
    expect(preloadSrc).toMatch(
      /installUpdate:\s*\(\)\s*=>\s*ipcRenderer\.invoke\(\s*['"]update:install['"]/
    )
  })

  it('preload subscribes the renderer to update:downloaded', () => {
    expect(preloadSrc).toMatch(/onUpdateDownloaded/)
    expect(preloadSrc).toMatch(/ipcRenderer\.on\(\s*['"]update:downloaded['"]/)
  })
})

describe('software-update settings flow: manual check + auto toggle', () => {
  it('registers a manual update:check handler', () => {
    expect(updaterSrc).toMatch(/ipcMain\.handle\(\s*['"]update:check['"]/)
  })

  it('exposes + persists the automatic-update preference (default ON)', () => {
    expect(updaterSrc).toMatch(/getSetting<boolean>\(\s*['"]updates:auto['"]\s*,\s*true\s*\)/)
    expect(updaterSrc).toMatch(/ipcMain\.handle\(\s*['"]update:set-auto['"]/)
    expect(updaterSrc).toMatch(/saveSetting\(\s*['"]updates:auto['"]/)
    expect(updaterSrc).toMatch(/ipcMain\.handle\(\s*['"]update:get-prefs['"]/)
  })

  it('only auto-downloads/installs + periodic-checks when the preference is on', () => {
    expect(updaterSrc).toMatch(/autoUpdater\.autoDownload\s*=\s*on/)
    expect(updaterSrc).toMatch(/autoUpdater\.autoInstallOnAppQuit\s*=\s*on/)
    expect(updaterSrc).toMatch(/if\s*\(\s*!autoEnabled\(\)\s*\)\s*return/)
  })

  it('returns a clear reason in a dev/unpackaged build instead of hanging', () => {
    // electron-updater can only check in a packaged, signed app; guard on
    // app.isPackaged so the manual check surfaces the real reason (not a timeout).
    expect(updaterSrc).toMatch(/if\s*\(\s*!app\.isPackaged\s*\)/)
    expect(updaterSrc).toMatch(/Updates only work in the installed app/)
  })

  it('registers the update IPC in EVERY build, engine only in production', () => {
    // Regression: the whole updater was set up behind `if (!is.dev)`, so a dev run had
    // no handler and the renderer's startup query threw "No handler registered for
    // 'update:staged-version'". The read-safe IPC surface must register unconditionally;
    // only the auto-download engine (feed + polling) is production-only.
    expect(updaterSrc).toMatch(/export function registerUpdateIpc\(\)/)
    // staged-version handler lives in the always-registered surface, not the engine.
    const ipcFn = updaterSrc.slice(updaterSrc.indexOf('export function registerUpdateIpc'))
    expect(ipcFn).toMatch(/ipcMain\.handle\(\s*['"]update:staged-version['"]/)
    // index calls registerUpdateIpc unconditionally, and guards ONLY startAutoUpdates.
    expect(indexSrc).toMatch(/m\.registerUpdateIpc\(\)/)
    expect(indexSrc).toMatch(/if\s*\(\s*!is\.dev\s*\)\s*m\.startAutoUpdates\(\)/)
  })

  it('allows downgrade only for an explicit channel switch or exact-version rollback', () => {
    // Regression: `autoUpdater.allowDowngrade = true` on every launch made a
    // 0.0.41-beta.69 app accept "Update 0.0.38". The knob must come from the pure
    // resolveChannelConfig during routine checks. The exact rollback path is the
    // only direct assignment because the user selected and confirmed that version.
    const rollbackStart = updaterSrc.indexOf('async function downloadPreviousVersion')
    const engineStart = updaterSrc.indexOf('export function startAutoUpdates')
    expect(rollbackStart).toBeGreaterThan(-1)
    expect(engineStart).toBeGreaterThan(rollbackStart)
    const routineSource = `${updaterSrc.slice(0, rollbackStart)}${updaterSrc.slice(engineStart)}`
    const rollbackSource = updaterSrc.slice(rollbackStart, engineStart)
    expect(routineSource).not.toMatch(/allowDowngrade\s*=\s*true/)
    expect(rollbackSource).toMatch(/allowDowngrade\s*=\s*true/)
    expect(rollbackSource).toMatch(/saveSetting\(\s*['"]updates:auto['"]\s*,\s*false\s*\)/)
    expect(updaterSrc).toMatch(/resolveChannelConfig/)
    expect(updaterSrc).toMatch(/applyChannel\(true\)/)
  })

  it('preload bridges the check + prefs controls', () => {
    expect(preloadSrc).toMatch(
      /checkForUpdates:\s*\(\)\s*=>\s*ipcRenderer\.invoke\(\s*['"]update:check['"]/
    )
    expect(preloadSrc).toMatch(
      /updateSetAuto:\s*\(on:\s*boolean\)\s*=>\s*ipcRenderer\.invoke\(\s*['"]update:set-auto['"]/
    )
    expect(preloadSrc).toMatch(
      /updateGetPrefs:\s*\(\)\s*=>\s*ipcRenderer\.invoke\(\s*['"]update:get-prefs['"]/
    )
    expect(preloadSrc).toMatch(
      /updateListVersions:\s*\(\)\s*=>\s*ipcRenderer\.invoke\(\s*['"]update:list-versions['"]/
    )
    expect(preloadSrc).toMatch(/updateDownloadVersion:[\s\S]*update:download-version/)
  })
})
