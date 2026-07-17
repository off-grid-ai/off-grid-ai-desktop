// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

type UpdateResult =
  | { status: 'available'; version: string }
  | { status: 'not-available'; version: string }
  | { status: 'error'; error: string }

const checkForUpdates = vi.fn<() => Promise<UpdateResult>>()

function stubApi(): void {
  const api = new Proxy(
    {
      isPro: false,
      platform: 'darwin',
      checkForUpdates,
      updateGetPrefs: () =>
        Promise.resolve({ currentVersion: '0.0.103', auto: true, channel: 'stable' }),
      getAppVersion: () => Promise.resolve('0.0.103')
    },
    {
      get: (target, prop) => {
        if (prop in target) return target[prop as keyof typeof target]
        return () => Promise.resolve({})
      }
    }
  )
  Object.defineProperty(window, 'api', { configurable: true, value: api })
  vi.stubGlobal('__OFFGRID_PRO__', false)
}

beforeEach(() => {
  stubApi()
})

afterEach(() => {
  cleanup()
  checkForUpdates.mockReset()
  vi.unstubAllGlobals()
  vi.resetModules()
})

async function renderUpdateCard(): Promise<HTMLElement> {
  const { Settings } = await import('../Settings')
  render(<Settings />)
  const heading = await screen.findByText('Software update')
  const card = heading.parentElement?.parentElement?.parentElement
  expect(card).toBeTruthy()
  await userEvent.click(heading)
  return card as HTMLElement
}

describe('Settings manual update check', () => {
  it('shows checking while pending, reports an available version, and re-enables the action', async () => {
    let resolveCheck: ((result: UpdateResult) => void) | undefined
    checkForUpdates.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveCheck = resolve
        })
    )
    const card = await renderUpdateCard()
    const user = userEvent.setup()

    await user.click(within(card).getByRole('button', { name: 'Check for updates' }))
    expect(within(card).getByRole('button', { name: 'Checking...' }).hasAttribute('disabled')).toBe(
      true
    )
    expect(within(card).getByText('Checking for updates...')).toBeTruthy()

    resolveCheck?.({ status: 'available', version: '0.0.104' })
    expect(
      await within(card).findByText(/Update 0\.0\.104 found\. Downloading in the background/)
    ).toBeTruthy()
    expect(
      within(card).getByRole('button', { name: 'Check for updates' }).hasAttribute('disabled')
    ).toBe(false)
  })

  it.each([
    [
      { status: 'not-available', version: '0.0.103' } as UpdateResult,
      "You're on the latest version (v0.0.103)."
    ],
    [
      { status: 'error', error: 'release feed unavailable' } as UpdateResult,
      'Could not check: release feed unavailable'
    ]
  ])('reports the terminal result and never leaves checking stuck', async (result, expected) => {
    checkForUpdates.mockResolvedValueOnce(result)
    const card = await renderUpdateCard()

    await userEvent.click(within(card).getByRole('button', { name: 'Check for updates' }))

    await waitFor(() => expect(within(card).getByText(expected)).toBeTruthy())
    expect(
      within(card).getByRole('button', { name: 'Check for updates' }).hasAttribute('disabled')
    ).toBe(false)
  })
})
