#!/usr/bin/env node
/* eslint-disable @typescript-eslint/explicit-function-return-type -- Node executes this release script directly. */
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

const [, , feedPath, distPath, outputPath, expectedVersion] = process.argv

if (!feedPath || !distPath || !outputPath || !expectedVersion) {
  console.error(
    'usage: prepare-mac-release-assets.mjs <feed.yml> <dist-dir> <output-dir> <version>'
  )
  process.exit(2)
}

function unquote(value) {
  const trimmed = value.trim()
  if (
    (trimmed.startsWith("'") && trimmed.endsWith("'")) ||
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
  ) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

function sha512(file) {
  const hash = createHash('sha512')
  const descriptor = fs.openSync(file, 'r')
  const buffer = Buffer.allocUnsafe(1024 * 1024)
  try {
    let bytesRead
    do {
      bytesRead = fs.readSync(descriptor, buffer, 0, buffer.length, null)
      if (bytesRead > 0) hash.update(buffer.subarray(0, bytesRead))
    } while (bytesRead > 0)
  } finally {
    fs.closeSync(descriptor)
  }
  return hash.digest('base64')
}

function parseFeed(source) {
  const version = source.match(/^version:\s*(.+)$/m)?.[1]
  const primaryPath = source.match(/^path:\s*(.+)$/m)?.[1]
  const files = [
    ...source.matchAll(/^\s*- url:\s*(.+)\n\s+sha512:\s*(\S+)\n\s+size:\s*(\d+)$/gm)
  ].map((match) => ({
    url: unquote(match[1]),
    sha512: match[2],
    size: Number(match[3])
  }))
  if (!version || !primaryPath || files.length === 0) {
    throw new Error('update metadata is missing version, path, or file records')
  }
  return { version: unquote(version), primaryPath: unquote(primaryPath), files }
}

const source = fs.readFileSync(feedPath, 'utf8')
const feed = parseFeed(source)
if (feed.version !== expectedVersion) {
  throw new Error(
    `update metadata version mismatch: expected ${expectedVersion}, found ${feed.version}`
  )
}
if (!feed.files.some((file) => file.url === feed.primaryPath)) {
  throw new Error(`update metadata primary path is not present in files: ${feed.primaryPath}`)
}
if (!feed.files.some((file) => file.url.endsWith('.zip'))) {
  throw new Error('update metadata has no updater ZIP')
}
if (!feed.files.some((file) => file.url.endsWith('.dmg'))) {
  throw new Error('update metadata has no DMG')
}

const candidates = fs
  .readdirSync(distPath, { withFileTypes: true })
  .filter((entry) => entry.isFile())
  .map((entry) => path.join(distPath, entry.name))
const digests = new Map()

function matchingArtifact(record) {
  const matches = candidates.filter((candidate) => {
    if (fs.statSync(candidate).size !== record.size) return false
    let digest = digests.get(candidate)
    if (!digest) {
      digest = sha512(candidate)
      digests.set(candidate, digest)
    }
    return digest === record.sha512
  })
  if (matches.length !== 1) {
    throw new Error(`expected exactly one artifact matching ${record.url}, found ${matches.length}`)
  }
  return matches[0]
}

const stagingPath = `${outputPath}.tmp-${process.pid}`
fs.rmSync(stagingPath, { recursive: true, force: true })
fs.mkdirSync(stagingPath, { recursive: true })

try {
  for (const record of feed.files) {
    const artifact = matchingArtifact(record)
    const blockmap = `${artifact}.blockmap`
    if (!fs.existsSync(blockmap) || !fs.statSync(blockmap).isFile()) {
      throw new Error(`artifact blockmap is missing: ${path.basename(blockmap)}`)
    }
    fs.copyFileSync(artifact, path.join(stagingPath, record.url))
    fs.copyFileSync(blockmap, path.join(stagingPath, `${record.url}.blockmap`))
  }
  fs.copyFileSync(feedPath, path.join(stagingPath, path.basename(feedPath)))
  fs.rmSync(outputPath, { recursive: true, force: true })
  fs.renameSync(stagingPath, outputPath)
} catch (error) {
  fs.rmSync(stagingPath, { recursive: true, force: true })
  throw error
}

for (const asset of fs.readdirSync(outputPath).sort()) {
  console.log(`[release-assets] ${asset}`)
}
