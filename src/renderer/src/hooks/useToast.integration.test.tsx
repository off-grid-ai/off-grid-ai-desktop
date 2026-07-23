// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { ToastProvider } from './ToastProvider'
import { useToast } from './useToast'

function ToastTrigger(): React.ReactElement {
  const { showToast } = useToast()
  return (
    <>
      <button onClick={() => showToast({ message: 'Saved locally' })}>Show toast</button>
      <button onClick={() => showToast({ message: 'Nothing changed', tone: 'neutral' })}>
        Show neutral toast
      </button>
      <button
        onClick={() =>
          showToast({
            message: 'Could not save locally',
            tone: 'error',
            actionLabel: 'Retry',
            onAction: () => showToast({ message: 'Saved after retry' })
          })
        }
      >
        Show failed toast
      </button>
    </>
  )
}

describe('ToastProvider', () => {
  afterEach(() => cleanup())

  it('renders independently identified transient messages', async () => {
    const user = userEvent.setup()
    render(
      <ToastProvider>
        <ToastTrigger />
      </ToastProvider>
    )

    await user.click(screen.getByRole('button', { name: 'Show toast' }))
    await user.click(screen.getByRole('button', { name: 'Show toast' }))

    expect(screen.getAllByText('Saved locally')).toHaveLength(2)
  })

  it('announces a failed action and lets the user retry it', async () => {
    const user = userEvent.setup()
    render(
      <ToastProvider>
        <ToastTrigger />
      </ToastProvider>
    )

    await user.click(screen.getByRole('button', { name: 'Show failed toast' }))
    const alert = screen.getByRole('alert')
    expect(alert.textContent).toContain('Could not save locally')

    await user.click(within(alert).getByRole('button', { name: 'Retry' }))
    expect(screen.queryByText('Could not save locally')).toBeNull()
    expect(screen.getByRole('status').textContent).toContain('Saved after retry')
  })

  it('announces neutral information without presenting it as success', async () => {
    const user = userEvent.setup()
    render(
      <ToastProvider>
        <ToastTrigger />
      </ToastProvider>
    )

    await user.click(screen.getByRole('button', { name: 'Show neutral toast' }))
    const status = screen.getByRole('status')
    expect(status.textContent).toContain('Nothing changed')
    expect(status.getAttribute('data-tone')).toBe('neutral')
  })
})
