// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { SettingsCard, SettingsCardsGroup } from '../SettingsCard'

describe('SettingsCardsGroup — grid drills into one L2 detail', () => {
  afterEach(cleanup)

  it('opens one card as the detail and hides the others; header goes back', () => {
    render(
      <SettingsCardsGroup>
        <SettingsCard title="Setup & health" summary="s1">
          <div>SETUP_BODY</div>
        </SettingsCard>
        <SettingsCard title="Data & privacy" summary="s2">
          <div>PRIVACY_BODY</div>
        </SettingsCard>
      </SettingsCardsGroup>
    )
    // Grid: both cards, no bodies.
    expect(screen.getByText('Setup & health')).toBeTruthy()
    expect(screen.getByText('Data & privacy')).toBeTruthy()
    expect(screen.queryByText('SETUP_BODY')).toBeNull()

    // Open one → its body shows, the other card is hidden, back affordance appears.
    fireEvent.click(screen.getByText('Setup & health'))
    expect(screen.getByText('SETUP_BODY')).toBeTruthy()
    expect(screen.queryByText('Data & privacy')).toBeNull()
    expect(screen.getByText('All settings')).toBeTruthy()

    // Click the open header again → back to the grid.
    fireEvent.click(screen.getByText('Setup & health'))
    expect(screen.getByText('Data & privacy')).toBeTruthy()
    expect(screen.queryByText('SETUP_BODY')).toBeNull()
  })

  it('without a group, each card keeps independent local open state', () => {
    render(
      <>
        <SettingsCard title="Alpha" summary="a">
          <div>ALPHA_BODY</div>
        </SettingsCard>
        <SettingsCard title="Beta" summary="b">
          <div>BETA_BODY</div>
        </SettingsCard>
      </>
    )
    fireEvent.click(screen.getByText('Alpha'))
    expect(screen.getByText('ALPHA_BODY')).toBeTruthy()
    expect(screen.getByText('Beta')).toBeTruthy() // not hidden — no group
  })
})
