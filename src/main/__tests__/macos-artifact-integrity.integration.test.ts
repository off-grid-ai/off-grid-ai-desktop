import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { afterEach, describe, expect, it } from 'vitest'
import {
  REQUIRED_MAC_BUNDLE_FILES,
  verifyBundlePair,
  verifyZipArtifact
} from '../../../scripts/lib/macos-artifact-integrity.mjs'

const REPO_ROOT = path.resolve(import.meta.dirname, '../../..')
const tempRoots: string[] = []
const FRAMEWORK_EXECUTABLE =
  'Contents/Frameworks/Electron Framework.framework/Versions/A/Electron Framework'

function tempBundle(prefix: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  tempRoots.push(root)
  return path.join(root, 'Off Grid AI Desktop.app')
}

function writeBundleFixture(bundle: string): void {
  for (const relative of REQUIRED_MAC_BUNDLE_FILES) {
    const file = path.join(bundle, relative)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, `fixture:${relative}`)
    if (relative !== 'Contents/Info.plist' && relative !== 'Contents/Resources/app.asar') {
      fs.chmodSync(file, 0o755)
    }
  }
}

function matchingBundles(): { packagedBundle: string; candidateBundle: string } {
  const packagedBundle = tempBundle('offgrid-packaged-app-')
  const candidateBundle = tempBundle('offgrid-dmg-app-')
  writeBundleFixture(packagedBundle)
  fs.cpSync(packagedBundle, candidateBundle, { recursive: true })
  return { packagedBundle, candidateBundle }
}

describe('macOS artifact integrity', () => {
  afterEach(() => {
    while (tempRoots.length) {
      fs.rmSync(tempRoots.pop()!, { recursive: true, force: true })
    }
  })

  it('accepts a candidate bundle with the packaged manifest and required file contents', () => {
    const { packagedBundle, candidateBundle } = matchingBundles()

    expect(() => verifyBundlePair(packagedBundle, candidateBundle)).not.toThrow()
  })

  it('blocks the exact DMG failure where staging lost the Electron Framework executable', () => {
    const { packagedBundle, candidateBundle } = matchingBundles()
    fs.rmSync(path.join(candidateBundle, FRAMEWORK_EXECUTABLE))

    expect(() => verifyBundlePair(packagedBundle, candidateBundle)).toThrow(
      `candidate bundle is missing required file: ${FRAMEWORK_EXECUTABLE}`
    )
  })

  it('blocks same-size required-file corruption that a manifest-only check would miss', () => {
    const { packagedBundle, candidateBundle } = matchingBundles()
    const executable = path.join(candidateBundle, FRAMEWORK_EXECUTABLE)
    const content = fs.readFileSync(executable, 'utf8')
    fs.writeFileSync(executable, content.replace('fixture', 'corrupt'))

    expect(() => verifyBundlePair(packagedBundle, candidateBundle)).toThrow(
      `candidate bundle required file content differs: ${FRAMEWORK_EXECUTABLE}`
    )
  })

  it('blocks private local state even when it exists in both bundle trees', () => {
    const { packagedBundle, candidateBundle } = matchingBundles()
    for (const bundle of [packagedBundle, candidateBundle]) {
      const privateFile = path.join(bundle, 'Contents/Resources/.offgrid/private.db')
      fs.mkdirSync(path.dirname(privateFile), { recursive: true })
      fs.writeFileSync(privateFile, 'private')
    }

    expect(() => verifyBundlePair(packagedBundle, candidateBundle)).toThrow(
      'packaged bundle contains forbidden private state: Contents/Resources/.offgrid'
    )
  })

  it.skipIf(process.platform !== 'darwin')(
    'extracts the real updater ZIP and rejects required-file corruption',
    async () => {
      const { packagedBundle, candidateBundle } = matchingBundles()
      const executable = path.join(candidateBundle, FRAMEWORK_EXECUTABLE)
      const content = fs.readFileSync(executable, 'utf8')
      fs.writeFileSync(executable, content.replace('fixture', 'corrupt'))
      const archive = path.join(path.dirname(candidateBundle), 'updater.zip')
      const create = spawnSync('/usr/bin/ditto', [
        '-c',
        '-k',
        '--keepParent',
        candidateBundle,
        archive
      ])
      expect(create.status, create.stderr?.toString()).toBe(0)

      await expect(verifyZipArtifact(archive, packagedBundle)).rejects.toThrow(
        `candidate bundle required file content differs: ${FRAMEWORK_EXECUTABLE}`
      )
    }
  )

  it('pins a fixed builder with explicit image headroom for the large macOS bundle', () => {
    const packageJson = JSON.parse(
      fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8')
    ) as {
      devDependencies: { 'electron-builder': string }
    }
    const builderVersion = packageJson.devDependencies['electron-builder']
    const [major = 0, minor = 0, patch = 0] = builderVersion.split('.').map(Number)
    const numericVersion = major * 1_000_000 + minor * 1_000 + patch
    const minimumFixedVersion = 26 * 1_000_000 + 15 * 1_000 + 3
    const builderConfig = fs.readFileSync(path.join(REPO_ROOT, 'electron-builder.yml'), 'utf8')
    const imageSizeGiB = Number(builderConfig.match(/^\s+size:\s+(\d+)g$/m)?.[1])

    expect(builderVersion).toMatch(/^\d+\.\d+\.\d+$/)
    expect(numericVersion).toBeGreaterThanOrEqual(minimumFixedVersion)
    expect(imageSizeGiB).toBeGreaterThanOrEqual(5)
    expect(builderConfig).toMatch(/^\s+shrink:\s+true$/m)
  })

  it('ad-hoc signs local bundles after fuses while keeping artifact verification strict', () => {
    const localBuild = fs.readFileSync(path.join(REPO_ROOT, 'scripts/build-mac-local.sh'), 'utf8')
    const artifactHook = fs.readFileSync(
      path.join(REPO_ROOT, 'scripts/verify-electron-builder-artifact.mjs'),
      'utf8'
    )

    expect(localBuild.match(/-c\.mac\.identity=-/g)).toHaveLength(2)
    expect(localBuild).toContain('export OFFGRID_ALLOW_LOCAL_ARTIFACT=1')
    expect(localBuild).toContain('export OFFGRID_LOCAL_PUBLISH_POLICY=never')
    expect(localBuild.match(/^\s+--publish never$/gm)).toHaveLength(2)
    expect(artifactHook).not.toContain('OFFGRID_ALLOW_UNSIGNED_ARTIFACT')
    expect(artifactHook).toContain("artifact.endsWith('.zip')")
    expect(artifactHook).toContain('verifyReleaseZipArtifact')
  })
})
