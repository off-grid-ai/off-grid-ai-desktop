// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ArtifactCanvas } from '../ArtifactCanvas'

afterEach(cleanup)

describe('ArtifactCanvas isolated preview', () => {
  it('renders executable HTML from the artifact origin and revokes it on close', async () => {
    const previewUrl = 'ogartifact://preview/00000000-0000-4000-8000-000000000000'
    const createArtifactPreview = vi.fn(async () => previewUrl)
    const revokeArtifactPreview = vi.fn(async () => true)
    ;(window as unknown as { api: unknown }).api = {
      artifactRuntime: vi.fn(async () => ({})),
      createArtifactPreview,
      revokeArtifactPreview
    }

    const { unmount } = render(
      <ArtifactCanvas
        artifact={{
          kind: 'html',
          code: '<button onclick="document.body.dataset.ran=1">Run</button>'
        }}
        onClose={() => {}}
      />
    )

    const frame = await screen.findByTitle<HTMLIFrameElement>('artifact')
    expect(frame.src).toBe(previewUrl)
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts')
    expect(frame.hasAttribute('srcdoc')).toBe(false)
    expect(createArtifactPreview).toHaveBeenCalledWith(expect.stringContaining('<button'))

    unmount()
    await waitFor(() => expect(revokeArtifactPreview).toHaveBeenCalledWith(previewUrl))
  })
})
