/**
 * Tests for the shared binary/file resolver used by both transcription CLIs. Runs against
 * a REAL temp dir (existing()'s only dependency is fs.existsSync) so the found / not-found
 * / per-candidate-error branches are all covered.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { existing } from '../bin-resolution'

let dir: string
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'offgrid-bin-'))
})
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

describe('existing', () => {
  it('returns null when no candidate exists', () => {
    expect(existing([path.join(dir, 'nope'), path.join(dir, 'also-nope')])).toBeNull()
  })

  it('returns null for an empty candidate list', () => {
    expect(existing([])).toBeNull()
  })

  it('returns the first path that exists on disk', () => {
    const real = path.join(dir, 'real')
    fs.writeFileSync(real, 'x')
    expect(existing([path.join(dir, 'missing'), real])).toBe(real)
  })

  it('skips a candidate whose stat throws and keeps scanning (per-candidate error swallowed)', () => {
    // fs.existsSync normally swallows its own errors, so force a throw at that boundary
    // to prove existing() treats a throwing candidate as "not present" and moves on.
    const real = path.join(dir, 'real')
    fs.writeFileSync(real, 'x')
    const spy = vi.spyOn(fs, 'existsSync').mockImplementation((p) => {
      if (p === '/throws') throw new Error('boom')
      return true
    })
    try {
      expect(existing(['/throws', real])).toBe(real)
    } finally {
      spy.mockRestore()
    }
  })

  it('returns null when the only candidate throws', () => {
    const spy = vi.spyOn(fs, 'existsSync').mockImplementation(() => {
      throw new Error('boom')
    })
    try {
      expect(existing(['/throws'])).toBeNull()
    } finally {
      spy.mockRestore()
    }
  })
})
