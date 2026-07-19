import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const REPO_ROOT = path.resolve(import.meta.dirname, '../../..')
const PREPARE = path.join(REPO_ROOT, 'scripts', 'prepare-mac-release-assets.mjs')
const VERSION = '9.8.7'

const sha512 = (content: Buffer): string => createHash('sha512').update(content).digest('base64')

describe('macOS release asset staging', () => {
  let root: string
  let dist: string
  let output: string

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'offgrid-release-assets-'))
    dist = path.join(root, 'dist')
    output = path.join(root, 'release-assets')
    fs.mkdirSync(dist)
  })

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true })
  })

  function writeArtifact(name: string, content: Buffer): void {
    fs.writeFileSync(path.join(dist, name), content)
    fs.writeFileSync(path.join(dist, `${name}.blockmap`), `blockmap:${name}`)
  }

  function writeFeed(zip: Buffer, dmg: Buffer): string {
    const feed = path.join(dist, 'latest-mac.yml')
    fs.writeFileSync(
      feed,
      `version: ${VERSION}
files:
  - url: Off-Grid-AI-Desktop-${VERSION}-arm64-mac.zip
    sha512: ${sha512(zip)}
    size: ${zip.length}
  - url: OffGrid-${VERSION}.dmg
    sha512: ${sha512(dmg)}
    size: ${dmg.length}
path: Off-Grid-AI-Desktop-${VERSION}-arm64-mac.zip
sha512: ${sha512(zip)}
`
    )
    return feed
  }

  it('stages the exact metadata-selected artifacts under their updater URLs', () => {
    const zip = Buffer.from('signed updater zip')
    const dmg = Buffer.from('signed installer dmg')
    writeArtifact(`Off Grid AI Desktop-${VERSION}-arm64-mac.zip`, zip)
    writeArtifact(`OffGrid-${VERSION}.dmg`, dmg)
    const feed = writeFeed(zip, dmg)

    const result = spawnSync(process.execPath, [PREPARE, feed, dist, output, VERSION], {
      encoding: 'utf8'
    })

    expect(result.status, result.stderr).toBe(0)
    expect(fs.readdirSync(output).sort()).toEqual([
      `Off-Grid-AI-Desktop-${VERSION}-arm64-mac.zip`,
      `Off-Grid-AI-Desktop-${VERSION}-arm64-mac.zip.blockmap`,
      `OffGrid-${VERSION}.dmg`,
      `OffGrid-${VERSION}.dmg.blockmap`,
      'latest-mac.yml'
    ])
    expect(
      fs.readFileSync(path.join(output, `Off-Grid-AI-Desktop-${VERSION}-arm64-mac.zip`))
    ).toEqual(zip)
  })

  it('rejects same-size bytes that do not match update metadata', () => {
    const zip = Buffer.from('signed updater zip')
    const dmg = Buffer.from('signed installer dmg')
    writeArtifact(
      `Off Grid AI Desktop-${VERSION}-arm64-mac.zip`,
      Buffer.from('corrupt updater zip')
    )
    writeArtifact(`OffGrid-${VERSION}.dmg`, dmg)
    const feed = writeFeed(zip, dmg)

    const result = spawnSync(process.execPath, [PREPARE, feed, dist, output, VERSION], {
      encoding: 'utf8'
    })

    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('expected exactly one artifact matching')
    expect(fs.existsSync(output)).toBe(false)
  })

  it('rejects an artifact whose differential-update blockmap is missing', () => {
    const zip = Buffer.from('signed updater zip')
    const dmg = Buffer.from('signed installer dmg')
    writeArtifact(`Off Grid AI Desktop-${VERSION}-arm64-mac.zip`, zip)
    writeArtifact(`OffGrid-${VERSION}.dmg`, dmg)
    fs.rmSync(path.join(dist, `OffGrid-${VERSION}.dmg.blockmap`))
    const feed = writeFeed(zip, dmg)

    const result = spawnSync(process.execPath, [PREPARE, feed, dist, output, VERSION], {
      encoding: 'utf8'
    })

    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('artifact blockmap is missing')
  })
})
