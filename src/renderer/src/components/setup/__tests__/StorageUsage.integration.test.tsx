// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DataPrivacyPanel } from '../DataPrivacyPanel'
import { StoragePanel } from '../StoragePanel'

describe('rendered storage usage', () => {
  beforeEach(() => {
    const api = {
      getStorageInfo: vi.fn(async () => ({
        dir: '/tmp/offgrid/models',
        totalBytes: 1_500_000_000,
        freeBytes: 6_000_000_000,
        models: [
          {
            id: 'text-model',
            name: 'Local text model',
            kind: 'text',
            bytes: 1_250_000_000,
            active: true
          },
          {
            id: 'vision-model',
            name: 'Local vision model',
            kind: 'vision',
            bytes: 250_000_000,
            active: false
          }
        ],
        orphans: []
      })),
      listDownloads: vi.fn(async () => []),
      getDataSummary: vi.fn(async () => [
        {
          id: 'captures',
          label: 'Screen captures',
          detail: 'Captured frames and OCR',
          count: 120,
          bytes: 2_000_000
        },
        {
          id: 'images',
          label: 'Generated images & artifacts',
          detail: 'Images, artifacts, and thumbnails',
          count: 3,
          bytes: 8_000_000
        }
      ]),
      onModelProgress: vi.fn(() => () => {})
    }
    ;(globalThis as unknown as { window: Window }).window.api = api as never
  })

  afterEach(() => {
    cleanup()
  })

  it('shows model totals, per-model sizes, and artifact category usage', async () => {
    render(
      <>
        <StoragePanel />
        <DataPrivacyPanel />
      </>
    )

    expect(await screen.findByText('1.5 GB used by models')).toBeTruthy()
    expect(screen.getByText('6.0 GB free')).toBeTruthy()
    expect(screen.getByText('Local text model')).toBeTruthy()
    expect(screen.getByText('1.3 GB')).toBeTruthy()
    expect(screen.getByText('Local vision model')).toBeTruthy()
    expect(screen.getByText('250 MB')).toBeTruthy()

    expect(await screen.findByText('Screen captures')).toBeTruthy()
    expect(screen.getByText(/Captured frames and OCR.*120 items.*2 MB/)).toBeTruthy()
    expect(screen.getByText('Generated images & artifacts')).toBeTruthy()
    expect(screen.getByText(/Images, artifacts, and thumbnails.*3 items.*8 MB/)).toBeTruthy()
  })
})
