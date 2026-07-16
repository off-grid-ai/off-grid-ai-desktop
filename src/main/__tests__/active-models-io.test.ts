/**
 * IO tests for the active-modalities store (getActiveModal / setActiveModal /
 * getAllActiveModals). The pure decision helpers (modalityForKind, isModelActive) are
 * covered in active-models.test.ts; this file exercises the thin JSON-file persistence
 * against a REAL temp dir (no mock of our own logic) so a corrupt/absent file, a round
 * trip, and the null-clear path all fail loudly if the behavior breaks.
 *
 * modelsDir (from runtime-env, Electron-bound) is redirected to a per-test temp dir —
 * that is the only boundary mocked; the fs reads/writes are real.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'

let tmpDir: string
vi.mock('../runtime-env', () => ({ modelsDir: () => tmpDir }))

import { getActiveModal, setActiveModal, getAllActiveModals } from '../active-models'

const storePath = () => path.join(tmpDir, 'active-modalities.json')

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'offgrid-active-models-'))
})
afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

describe('getActiveModal', () => {
  it('returns null for every modality when the store file is absent', () => {
    expect(getActiveModal('image')).toBeNull()
    expect(getActiveModal('speech')).toBeNull()
    expect(getActiveModal('transcription')).toBeNull()
  })

  it('returns null when the store file is corrupt JSON (readAll swallows the parse error)', () => {
    fs.writeFileSync(storePath(), '{ this is not json')
    expect(getActiveModal('transcription')).toBeNull()
  })

  it('reads back a persisted value', () => {
    fs.writeFileSync(storePath(), JSON.stringify({ transcription: 'csukuangfj/parakeet-v2' }))
    expect(getActiveModal('transcription')).toBe('csukuangfj/parakeet-v2')
  })
})

describe('setActiveModal', () => {
  it('writes a value that getActiveModal reads back (round trip)', () => {
    setActiveModal('image', 'org/jugg')
    expect(getActiveModal('image')).toBe('org/jugg')
    // Persisted as pretty JSON in the store file.
    expect(JSON.parse(fs.readFileSync(storePath(), 'utf-8')).image).toBe('org/jugg')
  })

  it('creates the models dir if it does not exist yet', () => {
    const nested = path.join(tmpDir, 'nested', 'dir')
    tmpDir = nested // point modelsDir() at a not-yet-created path
    setActiveModal('speech', 'kokoro')
    expect(getActiveModal('speech')).toBe('kokoro')
  })

  it('updates one modality without clobbering the others', () => {
    setActiveModal('image', 'img-1')
    setActiveModal('speech', 'voice-1')
    setActiveModal('image', 'img-2') // overwrite image only
    expect(getActiveModal('image')).toBe('img-2')
    expect(getActiveModal('speech')).toBe('voice-1')
  })

  it('clears a slot when set to null', () => {
    setActiveModal('transcription', 'whisper-small')
    setActiveModal('transcription', null)
    expect(getActiveModal('transcription')).toBeNull()
  })
})

describe('getAllActiveModals', () => {
  it('fills every modality with null when the store is empty', () => {
    expect(getAllActiveModals()).toEqual({ image: null, speech: null, transcription: null })
  })

  it('returns all three modalities, defaulting the unset ones to null', () => {
    setActiveModal('image', 'img-x')
    expect(getAllActiveModals()).toEqual({ image: 'img-x', speech: null, transcription: null })
  })

  it('reflects a full round trip across all three modalities', () => {
    setActiveModal('image', 'a')
    setActiveModal('speech', 'b')
    setActiveModal('transcription', 'c')
    expect(getAllActiveModals()).toEqual({ image: 'a', speech: 'b', transcription: 'c' })
  })
})
