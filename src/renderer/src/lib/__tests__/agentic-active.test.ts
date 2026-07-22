import { describe, it, expect } from 'vitest'
import { isAgenticTurn } from '../agentic-active'

describe('isAgenticTurn', () => {
  it('is on when Tools or Connectors is enabled, off when neither', () => {
    expect(isAgenticTurn({ toolsOn: true, connectorsOn: false })).toBe(true)
    expect(isAgenticTurn({ toolsOn: false, connectorsOn: true })).toBe(true)
    expect(isAgenticTurn({ toolsOn: true, connectorsOn: true })).toBe(true)
    expect(isAgenticTurn({ toolsOn: false, connectorsOn: false })).toBe(false)
  })

  it('has NO project input — agentic is never disabled by being in a project (regression)', () => {
    // The signature intentionally takes no projectId. If someone re-introduces a
    // `&& !projectId` gate they must change this signature, which breaks this guard.
    expect(isAgenticTurn.length).toBe(1)
    const keys = Object.keys({ toolsOn: true, connectorsOn: true })
    expect(keys).not.toContain('projectId')
  })
})
