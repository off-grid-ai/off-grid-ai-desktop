import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const REPO_ROOT = path.resolve(__dirname, '../../..')
const VERIFIER = path.join(REPO_ROOT, 'scripts', 'smoke-dmg-install.sh')
const CAN_MOUNT_DMG = process.platform === 'darwin' && fs.existsSync('/usr/bin/hdiutil')

const createAppBundle = (root: string, appName = 'Off Grid AI Desktop.app'): string => {
  const app = path.join(root, appName)
  const contents = path.join(app, 'Contents')
  const executable = path.join(contents, 'MacOS', 'Off Grid AI Desktop')
  fs.mkdirSync(path.dirname(executable), { recursive: true })
  fs.writeFileSync(
    path.join(contents, 'Info.plist'),
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleExecutable</key><string>Off Grid AI Desktop</string>
  <key>CFBundleIdentifier</key><string>co.getoffgridai.desktop.smoke-fixture</string>
  <key>CFBundleName</key><string>Off Grid AI Desktop</string>
  <key>CFBundlePackageType</key><string>APPL</string>
</dict></plist>
`
  )
  fs.writeFileSync(executable, '#!/usr/bin/env bash\nexit 0\n')
  fs.chmodSync(executable, 0o755)
  fs.writeFileSync(path.join(contents, 'fixture-marker.txt'), 'copied-from-mounted-dmg')
  return app
}

const createDmg = (source: string, output: string): void => {
  const result = spawnSync(
    '/usr/bin/hdiutil',
    [
      'create',
      '-quiet',
      '-fs',
      'HFS+',
      '-volname',
      'OGAD DMG smoke',
      '-srcfolder',
      source,
      '-format',
      'UDZO',
      output
    ],
    { encoding: 'utf8' }
  )
  expect(result.status, result.stderr).toBe(0)
}

describe.skipIf(!CAN_MOUNT_DMG)('DMG installed-copy smoke verifier', () => {
  let root: string

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'offgrid-dmg-verifier-test-'))
  })

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true })
  })

  it('mounts a real DMG read-only, copies its app outside /Applications, detaches, then runs smoke', () => {
    const source = path.join(root, 'source')
    fs.mkdirSync(source)
    createAppBundle(source)
    const dmg = path.join(root, 'OffGrid-test.dmg')
    createDmg(source, dmg)

    const capture = path.join(root, 'smoke-capture.txt')
    const runner = path.join(root, 'assert-installed-copy.sh')
    fs.writeFileSync(
      runner,
      `#!/usr/bin/env bash
set -euo pipefail
: "\${APP:?missing copied app path}"
: "\${OFFGRID_DMG_MOUNT_POINT:?missing mount point}"
case "$APP" in /Applications/*) exit 21 ;; esac
test -x "$APP/Contents/MacOS/Off Grid AI Desktop"
test "$(cat "$APP/Contents/fixture-marker.txt")" = copied-from-mounted-dmg
test ! -e "$OFFGRID_DMG_MOUNT_POINT/Off Grid AI Desktop.app"
printf '%s\n' "$APP" > "$DMG_SMOKE_CAPTURE"
`
    )

    const result = spawnSync('bash', [VERIFIER, dmg], {
      encoding: 'utf8',
      env: {
        ...process.env,
        DMG_SMOKE_RUNNER: runner,
        DMG_SMOKE_CAPTURE: capture
      }
    })

    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0)
    const installedApp = fs.readFileSync(capture, 'utf8').trim()
    expect(installedApp).toContain('/offgrid-dmg-install.')
    expect(installedApp).toMatch(/\/install\/Off Grid AI Desktop\.app$/)
    expect(installedApp.startsWith('/Applications/')).toBe(false)
    expect(fs.existsSync(installedApp)).toBe(false)
  }, 30_000)

  it('rejects an ambiguous image instead of silently choosing one app', () => {
    const source = path.join(root, 'source')
    fs.mkdirSync(source)
    createAppBundle(source)
    createAppBundle(source, 'Unexpected Copy.app')
    const dmg = path.join(root, 'OffGrid-ambiguous.dmg')
    createDmg(source, dmg)

    const runner = path.join(root, 'must-not-run.sh')
    fs.writeFileSync(runner, '#!/usr/bin/env bash\nexit 99\n')
    const result = spawnSync('bash', [VERIFIER, dmg], {
      encoding: 'utf8',
      env: { ...process.env, DMG_SMOKE_RUNNER: runner }
    })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('expected exactly one .app in the DMG, found 2')
  }, 30_000)

  it('rejects a missing DMG before creating or mounting anything', () => {
    const result = spawnSync('bash', [VERIFIER, path.join(root, 'missing.dmg')], {
      encoding: 'utf8'
    })

    expect(result.status).toBe(2)
    expect(result.stderr).toContain('pass an existing DMG path')
  })
})
