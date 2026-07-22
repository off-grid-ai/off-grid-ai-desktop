/**
 * Regression guard for the meeting recorder's crash-safety. The data-loss fix
 * (killing the app mid-recording lost the whole file) lives in the Swift source:
 * AVAssetWriter must write FRAGMENTED output (movieFragmentInterval) so a file
 * killed before finishWriting() is still playable up to the last flushed fragment.
 * Per the repo's prompt/contract-guard convention we assert it by reading the
 * source, not by rebuilding + running the native binary.
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const SRC = fs.readFileSync(
  path.resolve(__dirname, '../../../scripts/meeting-recorder/main.swift'),
  'utf-8'
)

describe('meeting recorder — crash safety', () => {
  it('writes fragmented output so a killed recording is not lost', () => {
    // The line that makes partial recordings recoverable.
    expect(SRC).toMatch(/movieFragmentInterval\s*=/)
  })

  it('sets the fragment interval before writing begins (must precede startWriting)', () => {
    const fragIdx = SRC.indexOf('movieFragmentInterval')
    const startIdx = SRC.indexOf('startWriting()')
    expect(fragIdx).toBeGreaterThan(-1)
    expect(startIdx).toBeGreaterThan(-1)
    expect(fragIdx).toBeLessThan(startIdx)
  })
})
