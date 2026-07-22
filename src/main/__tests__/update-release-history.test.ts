import { describe, expect, it, vi } from 'vitest'
import { listPreviousUpdateReleases, parsePreviousUpdateReleases } from '../update-release-history'

const releases = [
  {
    tag_name: 'v0.0.41-beta.72',
    draft: false,
    published_at: '2026-07-22T12:00:00Z',
    assets: [
      {
        name: 'latest-mac.yml',
        browser_download_url:
          'https://github.com/off-grid-ai/off-grid-ai-desktop/releases/download/v0.0.41-beta.72/latest-mac.yml'
      }
    ]
  },
  {
    tag_name: 'v0.0.41-beta.71',
    draft: false,
    published_at: '2026-07-21T12:00:00Z',
    assets: [
      {
        name: 'latest-mac.yml',
        browser_download_url:
          'https://github.com/off-grid-ai/off-grid-ai-desktop/releases/download/v0.0.41-beta.71/latest-mac.yml'
      },
      {
        name: 'latest.yml',
        browser_download_url:
          'https://github.com/off-grid-ai/off-grid-ai-desktop/releases/download/v0.0.41-beta.71/latest.yml'
      }
    ]
  },
  {
    tag_name: 'v0.0.40',
    draft: false,
    published_at: '2026-07-01T12:00:00Z',
    assets: [
      {
        name: 'latest-mac.yml',
        browser_download_url:
          'https://github.com/off-grid-ai/off-grid-ai-desktop/releases/download/v0.0.40/latest-mac.yml'
      }
    ]
  }
]

describe('previous update releases', () => {
  it('keeps only older signed-update feeds for the running platform and sorts newest first', () => {
    expect(parsePreviousUpdateReleases(releases, '0.0.41-beta.72', 'darwin')).toEqual([
      {
        version: '0.0.41-beta.71',
        channel: 'nightly',
        publishedAt: '2026-07-21T12:00:00Z',
        feedUrl:
          'https://github.com/off-grid-ai/off-grid-ai-desktop/releases/download/v0.0.41-beta.71/'
      },
      {
        version: '0.0.40',
        channel: 'stable',
        publishedAt: '2026-07-01T12:00:00Z',
        feedUrl: 'https://github.com/off-grid-ai/off-grid-ai-desktop/releases/download/v0.0.40/'
      }
    ])
  })

  it('rejects drafts, invalid versions, newer versions, foreign URLs, and releases without a feed', () => {
    const invalid = [
      { ...releases[1], draft: true },
      { ...releases[1], tag_name: 'not-semver' },
      { ...releases[1], tag_name: 'v0.0.42' },
      {
        ...releases[1],
        assets: [
          {
            name: 'latest-mac.yml',
            browser_download_url: 'https://example.com/releases/latest-mac.yml'
          }
        ]
      },
      {
        ...releases[1],
        assets: [{ name: 'notes.txt', browser_download_url: 'https://github.com' }]
      }
    ]
    expect(parsePreviousUpdateReleases(invalid, '0.0.41-beta.72', 'darwin')).toEqual([])
    expect(parsePreviousUpdateReleases(releases, 'invalid', 'darwin')).toEqual([])
    expect(parsePreviousUpdateReleases(releases, '0.0.41-beta.72', 'linux')).toEqual([])
  })

  it('uses the Windows feed on Windows', () => {
    expect(parsePreviousUpdateReleases(releases, '0.0.41-beta.72', 'win32')).toEqual([
      expect.objectContaining({ version: '0.0.41-beta.71' })
    ])
  })

  it('bounds the GitHub request and reports a useful failure', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(releases), { status: 200 }))
    await expect(
      listPreviousUpdateReleases({
        currentVersion: '0.0.41-beta.72',
        platform: 'darwin',
        fetchImpl
      })
    ).resolves.toHaveLength(2)
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.github.com/repos/off-grid-ai/off-grid-ai-desktop/releases?per_page=50',
      expect.objectContaining({
        headers: expect.objectContaining({ Accept: 'application/vnd.github+json' })
      })
    )

    await expect(
      listPreviousUpdateReleases({
        currentVersion: '0.0.41-beta.72',
        platform: 'darwin',
        fetchImpl: vi.fn(async () => new Response('rate limited', { status: 403 }))
      })
    ).rejects.toThrow('GitHub release history returned HTTP 403.')
  })
})
