// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SkillsPanel } from '../SkillsPanel'

function installSkillBoundary(trigger: unknown): void {
  ;(globalThis as unknown as { window: { api: unknown } }).window.api = {
    isPro: true,
    listSkills: vi.fn(async () => [{ name: 'capture-review', description: 'Review captures' }]),
    getSkill: vi.fn(async () => ({
      name: 'capture-review',
      description: 'Review captures',
      instructions: 'Review the latest capture.',
      trigger
    })),
    saveSkill: vi.fn(async () => undefined),
    deleteSkill: vi.fn(async () => true)
  }
}

describe('<SkillsPanel/> persisted trigger recovery', () => {
  afterEach(() => cleanup())

  it.each([
    ['a keyword trigger without keywords', { kind: 'keyword' }],
    ['a schedule trigger without a time', { kind: 'schedule' }],
    ['an unknown trigger kind', { kind: 'webhook', on: 'calendar' }]
  ])(
    'opens %s as a manual skill instead of crashing or changing its meaning',
    async (_label, trigger) => {
      installSkillBoundary(trigger)
      const user = userEvent.setup()
      render(<SkillsPanel onClose={() => {}} />)

      await user.click(await screen.findByRole('button', { name: /capture-review/i }))

      expect(await screen.findByDisplayValue('capture-review')).not.toBeNull()
      expect(
        screen.getByRole('option', { name: 'Manual only (invoke with /name)', selected: true })
      ).not.toBeNull()
      expect(screen.queryByPlaceholderText('invoice, payment, contract')).toBeNull()
      expect(screen.queryByPlaceholderText('08:00')).toBeNull()
    }
  )
})
