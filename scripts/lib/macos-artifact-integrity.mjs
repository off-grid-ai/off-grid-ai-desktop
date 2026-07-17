import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export const REQUIRED_MAC_BUNDLE_FILES = Object.freeze([
  'Contents/Info.plist',
  'Contents/MacOS/Off Grid AI Desktop',
  'Contents/Frameworks/Electron Framework.framework/Versions/A/Electron Framework',
  'Contents/Resources/app.asar',
  'Contents/Resources/bin/llama/llama-server',
  'Contents/Resources/bin/meeting-recorder',
  'Contents/Resources/bin/dictation-hotkey'
])

export const REQUIRED_EXECUTABLE_FILES = new Set([
  'Contents/MacOS/Off Grid AI Desktop',
  'Contents/Frameworks/Electron Framework.framework/Versions/A/Electron Framework',
  'Contents/Resources/bin/llama/llama-server',
  'Contents/Resources/bin/meeting-recorder',
  'Contents/Resources/bin/dictation-hotkey'
])

const FORBIDDEN_PRIVATE_SEGMENTS = new Set(['.demo-profile', '.offgrid', '.claude', '.Codex'])

function normalizeRelative(relative) {
  return relative.split(path.sep).join('/')
}

function fileDigest(file) {
  const hash = createHash('sha256')
  const descriptor = fs.openSync(file, 'r')
  const buffer = Buffer.allocUnsafe(1024 * 1024)

  try {
    let bytesRead
    do {
      bytesRead = fs.readSync(descriptor, buffer, 0, buffer.length, null)
      if (bytesRead > 0) {
        hash.update(buffer.subarray(0, bytesRead))
      }
    } while (bytesRead > 0)
  } finally {
    fs.closeSync(descriptor)
  }

  return hash.digest('hex')
}

function entryKind(stat) {
  if (stat.isFile()) return 'file'
  if (stat.isDirectory()) return 'directory'
  if (stat.isSymbolicLink()) return 'symlink'
  return 'other'
}

function bundleManifest(bundle) {
  const manifest = new Map()

  function visit(directory, relativeDirectory = '') {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const relative = normalizeRelative(path.join(relativeDirectory, entry.name))
      const absolute = path.join(directory, entry.name)
      const stat = fs.lstatSync(absolute)
      const kind = entryKind(stat)

      manifest.set(relative, {
        kind,
        size: kind === 'file' ? stat.size : undefined,
        target: kind === 'symlink' ? fs.readlinkSync(absolute) : undefined
      })

      if (kind === 'directory') {
        visit(absolute, relative)
      }
    }
  }

  visit(bundle)
  return manifest
}

function assertBundleRoot(bundle, label) {
  if (!fs.existsSync(bundle) || !fs.statSync(bundle).isDirectory()) {
    throw new Error(`${label} bundle is not a directory: ${bundle}`)
  }
}

function assertRequiredFiles(bundle, label) {
  for (const relative of REQUIRED_MAC_BUNDLE_FILES) {
    const file = path.join(bundle, relative)
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
      throw new Error(`${label} bundle is missing required file: ${relative}`)
    }
    if (REQUIRED_EXECUTABLE_FILES.has(relative) && (fs.statSync(file).mode & 0o111) === 0) {
      throw new Error(`${label} bundle required file is not executable: ${relative}`)
    }
  }
}

function assertNoPrivateState(manifest, label) {
  for (const relative of manifest.keys()) {
    const privateSegment = relative
      .split('/')
      .find((segment) => FORBIDDEN_PRIVATE_SEGMENTS.has(segment))
    if (privateSegment) {
      throw new Error(`${label} bundle contains forbidden private state: ${relative}`)
    }
  }
}

function compareManifests(reference, candidate) {
  const missing = [...reference.keys()].filter((relative) => !candidate.has(relative))
  const extra = [...candidate.keys()].filter((relative) => !reference.has(relative))
  const changed = [...reference.entries()]
    .filter(([relative, expected]) => {
      const actual = candidate.get(relative)
      return (
        actual &&
        (actual.kind !== expected.kind ||
          actual.size !== expected.size ||
          actual.target !== expected.target)
      )
    })
    .map(([relative]) => relative)

  if (missing.length || extra.length || changed.length) {
    const details = [
      ...missing.map((relative) => `missing: ${relative}`),
      ...extra.map((relative) => `extra: ${relative}`),
      ...changed.map((relative) => `changed: ${relative}`)
    ]
    throw new Error(`candidate bundle differs from packaged bundle:\n${details.join('\n')}`)
  }
}

function compareRequiredDigests(referenceBundle, candidateBundle) {
  for (const relative of REQUIRED_MAC_BUNDLE_FILES) {
    const referenceDigest = fileDigest(path.join(referenceBundle, relative))
    const candidateDigest = fileDigest(path.join(candidateBundle, relative))
    if (referenceDigest !== candidateDigest) {
      throw new Error(`candidate bundle required file content differs: ${relative}`)
    }
  }
}

export function verifyBundlePair(referenceBundle, candidateBundle) {
  assertBundleRoot(referenceBundle, 'packaged')
  assertBundleRoot(candidateBundle, 'candidate')
  assertRequiredFiles(referenceBundle, 'packaged')
  assertRequiredFiles(candidateBundle, 'candidate')

  const referenceManifest = bundleManifest(referenceBundle)
  const candidateManifest = bundleManifest(candidateBundle)
  assertNoPrivateState(referenceManifest, 'packaged')
  assertNoPrivateState(candidateManifest, 'candidate')
  compareManifests(referenceManifest, candidateManifest)
  compareRequiredDigests(referenceBundle, candidateBundle)
}

function findSingleApp(mountPoint) {
  const apps = fs
    .readdirSync(mountPoint, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.endsWith('.app'))
    .map((entry) => path.join(mountPoint, entry.name))

  if (apps.length !== 1) {
    throw new Error(`expected exactly one app bundle in DMG, found ${apps.length}`)
  }
  return apps[0]
}

export async function verifyDmgArtifact(dmgPath, referenceBundle) {
  if (process.platform !== 'darwin') {
    throw new Error('DMG integrity verification requires macOS')
  }
  if (!fs.existsSync(dmgPath) || !fs.statSync(dmgPath).isFile()) {
    throw new Error(`DMG artifact does not exist: ${dmgPath}`)
  }

  const workRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'offgrid-dmg-integrity-'))
  const mountPoint = path.join(workRoot, 'mount')
  fs.mkdirSync(mountPoint)
  let attached = false

  try {
    await execFileAsync('/usr/bin/hdiutil', [
      'attach',
      dmgPath,
      '-readonly',
      '-nobrowse',
      '-mountpoint',
      mountPoint
    ])
    attached = true
    const candidateBundle = findSingleApp(mountPoint)
    verifyBundlePair(referenceBundle, candidateBundle)
    await execFileAsync('/usr/bin/codesign', ['--verify', '--deep', '--strict', candidateBundle])
  } finally {
    if (attached) {
      await execFileAsync('/usr/bin/hdiutil', ['detach', mountPoint, '-force']).catch(
        () => undefined
      )
    }
    fs.rmSync(workRoot, { recursive: true, force: true })
  }
}
