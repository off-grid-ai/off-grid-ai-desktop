// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { ToastProvider } from './ToastProvider'
import { useToast } from './useToast'

function ToastTrigger(): React.ReactElement {
  const { showToast } = useToast()
  return <button onClick={() => showToast({ message: 'Saved locally' })}>Show toast</button>
}

describe('ToastProvider', () => {
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
})
