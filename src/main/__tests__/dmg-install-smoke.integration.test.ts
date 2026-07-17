import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import {
  REQUIRED_EXECUTABLE_FILES,
  REQUIRED_MAC_BUNDLE_FILES
} from '../../../scripts/lib/macos-artifact-integrity.mjs'

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

const makeReleaseShapedBundle = (root: string): string => {
  const nativeFixture = path.join(path.dirname(root), 'native-fixture')
  const compile = spawnSync('/usr/bin/clang', ['-x', 'c', '-', '-o', nativeFixture], {
    encoding: 'utf8',
    input: 'int main(void) { return 0; }\n'
  })
  if (compile.status !== 0) throw new Error(compile.stderr)

  const app = createAppBundle(root)
  fs.rmSync(path.join(app, 'Contents/fixture-marker.txt'))
  for (const relative of REQUIRED_MAC_BUNDLE_FILES) {
    const file = path.join(app, relative)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    if (REQUIRED_EXECUTABLE_FILES.has(relative)) {
      fs.copyFileSync(nativeFixture, file)
      fs.chmodSync(file, 0o755)
    } else if (fs.existsSync(file)) {
      continue
    } else {
      fs.writeFileSync(file, `fixture:${relative}`)
    }
  }
  const framework = path.join(app, 'Contents/Frameworks/Electron Framework.framework')
  const frameworkResources = path.join(framework, 'Versions/A/Resources')
  fs.mkdirSync(frameworkResources, { recursive: true })
  fs.writeFileSync(
    path.join(frameworkResources, 'Info.plist'),
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleExecutable</key><string>Electron Framework</string>
  <key>CFBundleIdentifier</key><string>co.getoffgridai.desktop.framework-fixture</string>
  <key>CFBundlePackageType</key><string>FMWK</string>
  <key>CFBundleVersion</key><string>1</string>
</dict></plist>
`
  )
  fs.symlinkSync('A', path.join(framework, 'Versions/Current'))
  fs.symlinkSync('Versions/Current/Electron Framework', path.join(framework, 'Electron Framework'))
  fs.symlinkSync('Versions/Current/Resources', path.join(framework, 'Resources'))
  return app
}

const codesign = (...args: string[]): ReturnType<typeof spawnSync> =>
  spawnSync('/usr/bin/codesign', args, { encoding: 'utf8' })

const textSectionOffset = (executable: string): number => {
  const result = spawnSync('/usr/bin/otool', ['-l', executable], { encoding: 'utf8' })
  if (result.status !== 0) throw new Error(result.stderr)
  const offset = result.stdout.match(/sectname __text[\s\S]*?\boffset (\d+)/)?.[1]
  if (!offset) throw new Error(`No __text offset in ${executable}`)
  return Number(offset)
}

const signReleaseShapedBundle = (app: string): ReturnType<typeof spawnSync>[] => {
  const framework = path.join(app, 'Contents/Frameworks/Electron Framework.framework')
  return [
    ...[...REQUIRED_EXECUTABLE_FILES]
      .filter(
        (relative) =>
          relative.startsWith('Contents/Resources/bin/') || relative.includes('.framework/')
      )
      .map((relative) => codesign('--force', '--sign', '-', path.join(app, relative))),
    codesign('--force', '--sign', '-', framework),
    codesign('--force', '--sign', '-', app)
  ]
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

  it('uses the isolated packaged UI smoke by default with the copied executable', () => {
    const source = path.join(root, 'source')
    fs.mkdirSync(source)
    createAppBundle(source)
    const dmg = path.join(root, 'OffGrid-default-smoke.dmg')
    createDmg(source, dmg)

    const capture = path.join(root, 'default-smoke-capture.txt')
    const binDir = path.join(root, 'bin')
    fs.mkdirSync(binDir)
    fs.writeFileSync(
      path.join(binDir, 'node'),
      `#!/usr/bin/env bash
set -euo pipefail
test "$1" = "$EXPECTED_SMOKE_TEST"
: "\${APP_BIN:?missing copied executable path}"
: "\${OFFGRID_DMG_MOUNT_POINT:?missing mount point}"
case "$APP_BIN" in /Applications/*) exit 21 ;; esac
test -x "$APP_BIN"
test ! -e "$OFFGRID_DMG_MOUNT_POINT/Off Grid AI Desktop.app"
printf '%s\n' "$APP_BIN" > "$DMG_SMOKE_CAPTURE"
`
    )
    fs.chmodSync(path.join(binDir, 'node'), 0o755)

    const result = spawnSync('bash', [VERIFIER, dmg], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${binDir}:${process.env.PATH ?? ''}`,
        EXPECTED_SMOKE_TEST: path.join(REPO_ROOT, 'scripts', 'smoke-test.mjs'),
        DMG_SMOKE_CAPTURE: capture
      }
    })

    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0)
    const installedExecutable = fs.readFileSync(capture, 'utf8').trim()
    expect(installedExecutable).toMatch(
      /\/install\/Off Grid AI Desktop\.app\/Contents\/MacOS\/Off Grid AI Desktop$/
    )
    expect(fs.existsSync(installedExecutable)).toBe(false)
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

  it('re-signs after a fuse-like mutation and preserves strict signatures through install', () => {
    const source = path.join(root, 'source')
    fs.mkdirSync(source)
    const app = makeReleaseShapedBundle(source)
    const framework = path.join(
      app,
      'Contents/Frameworks/Electron Framework.framework/Versions/A/Electron Framework'
    )

    for (const result of signReleaseShapedBundle(app)) {
      expect(result.status, String(result.stderr)).toBe(0)
    }
    expect(codesign('--verify', '--deep', '--strict', app).status).toBe(0)

    const descriptor = fs.openSync(framework, 'r+')
    const changedByte = Buffer.alloc(1)
    const mutationOffset = textSectionOffset(framework) + 4
    fs.readSync(descriptor, changedByte, 0, 1, mutationOffset)
    changedByte[0] = changedByte[0]! ^ 1
    fs.writeSync(descriptor, changedByte, 0, 1, mutationOffset)
    fs.closeSync(descriptor)
    expect(codesign('--verify', '--deep', '--strict', app).status).not.toBe(0)

    for (const result of signReleaseShapedBundle(app)) {
      expect(result.status, String(result.stderr)).toBe(0)
    }
    expect(codesign('--verify', '--deep', '--strict', app).status).toBe(0)

    const dmg = path.join(root, 'OffGrid-signed-after-fuses.dmg')
    createDmg(source, dmg)
    const runner = path.join(root, 'verify-installed-signature.sh')
    fs.writeFileSync(
      runner,
      '#!/usr/bin/env bash\nset -euo pipefail\n/usr/bin/codesign --verify --deep --strict "$APP"\n'
    )

    const result = spawnSync('bash', [VERIFIER, dmg], {
      encoding: 'utf8',
      env: {
        ...process.env,
        DMG_REFERENCE_APP: app,
        DMG_SMOKE_RUNNER: runner
      }
    })

    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0)
  }, 30_000)
})
