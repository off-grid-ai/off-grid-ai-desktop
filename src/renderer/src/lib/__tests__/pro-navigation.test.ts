import { describe, expect, it } from 'vitest'
import { normalizeProNavigationIntent } from '../pro-navigation'

describe('normalizeProNavigationIntent', () => {
  it('preserves exact action, entity, meeting, and replay targets', () => {
    expect(
      normalizeProNavigationIntent({
        view: 'actions',
        actionId: 42,
        mode: 'todo',
        entity: { id: 7, name: '  Maya  ' }
      })
    ).toEqual({
      view: 'actions',
      actionId: 42,
      mode: 'todo',
      entity: { id: 7, name: 'Maya' }
    })
    expect(normalizeProNavigationIntent({ view: 'meetings', meetingId: 8 })).toEqual({
      view: 'meetings',
      meetingId: 8
    })
    expect(normalizeProNavigationIntent({ view: 'replay', seekMs: 1_752_742_800_000 })).toEqual({
      view: 'replay',
      seekMs: 1_752_742_800_000
    })
  })

  it('keeps valid collection-level destinations target-free', () => {
    expect(normalizeProNavigationIntent({ view: 'actions', mode: 'approvals' })).toEqual({
      view: 'actions',
      mode: 'approvals'
    })
    expect(normalizeProNavigationIntent({ view: 'meetings' })).toEqual({ view: 'meetings' })
    expect(normalizeProNavigationIntent({ view: 'replay' })).toEqual({ view: 'replay' })
  })

  it.each([
    null,
    { view: 'unknown' },
    { view: 'actions', actionId: 0 },
    { view: 'actions', actionId: 1.5 },
    { view: 'actions', mode: 'history' },
    { view: 'actions', entity: { id: -1, name: 'Maya' } },
    { view: 'actions', entity: { id: 7, name: ' ' } },
    { view: 'meetings', meetingId: Number.NaN },
    { view: 'replay', seekMs: -1 }
  ])('rejects invalid navigation data without a fallback route: %j', (intent) => {
    expect(normalizeProNavigationIntent(intent)).toBeNull()
  })
})
