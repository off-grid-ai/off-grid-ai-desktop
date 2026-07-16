// D3 — starting the same model download twice (double-click, or Retry while it's
// already downloading) had two writers racing into the same `<file>.part`
// (interleaved writes → corrupt file), and the second overwrote the first's
// AbortController so a later Cancel/Clear controlled the wrong download.
//
// Fix: downloadModel no-ops if a download for that id is already in flight. The
// full concurrent flow needs the network/catalog/llm stack (heavy import); this is
// the source-contract guard that the re-entrancy check is present and runs BEFORE
// the controller registration — red on HEAD (no guard). The on-device check
// (double-click Download → one download, Cancel works) is in DEVICE_TEST_LOG.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

const src = readFileSync(join(__dirname, '..', '..', 'models-manager.ts'), 'utf8')
const fn = src.slice(
  src.indexOf('export async function downloadModel'),
  src.indexOf('export function downloadStatus') >= 0
    ? src.indexOf('/** Delete a model')
    : src.length
)

describe('downloadModel re-entrancy guard (D3)', () => {
  it('returns early when a download for the same id is already in flight', () => {
    expect(fn).toMatch(/if \(controllers\.has\(modelId\)\) return/)
  })

  it('guards BEFORE registering the controller (so the check is meaningful)', () => {
    const guardIdx = fn.indexOf('controllers.has(modelId)) return')
    const setIdx = fn.indexOf('controllers.set(modelId')
    expect(guardIdx).toBeGreaterThan(0)
    expect(setIdx).toBeGreaterThan(guardIdx) // set comes after the guard
  })
})
