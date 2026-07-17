import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  REQUIRED_MAC_BUNDLE_FILES,
  verifyBundlePair
} from '../../../scripts/lib/macos-artifact-integrity.mjs'

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
})
