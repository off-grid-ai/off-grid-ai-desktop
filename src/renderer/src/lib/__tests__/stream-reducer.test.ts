import { describe, it, expect } from 'vitest'
import { applyStreamEvent, type StreamedMessage } from '../stream-reducer'

describe('applyStreamEvent', () => {
  it('appends content deltas and clears activity', () => {
    const r = applyStreamEvent(
      { content: 'Hel', activity: { kind: 'running_tool', name: 'x' } },
      { type: 'content', text: 'lo' }
    )
    expect(r.content).toBe('Hello')
    expect(r.activity).toBeUndefined()
  })

  it('appends reasoning deltas', () => {
    expect(applyStreamEvent({ reasoning: 'a' }, { type: 'reasoning', text: 'b' }).reasoning).toBe(
      'ab'
    )
  })

  it('accumulates completed tool calls (live + persisted), in order', () => {
    let m = { toolCalls: [] as { name: string; result: string }[] }
    m = applyStreamEvent(m, { type: 'tool_result', call: { name: 'web_search', result: 'r1' } })
    m = applyStreamEvent(m, { type: 'tool_result', call: { name: 'read_url', result: 'r2' } })
    expect(m.toolCalls).toEqual([
      { name: 'web_search', result: 'r1' },
      { name: 'read_url', result: 'r2' }
    ])
  })

  it('sets the live activity on a step event without touching tool calls', () => {
    const r = applyStreamEvent<StreamedMessage>(
      { toolCalls: [{ name: 'web_search', result: 'r1' }] },
      { type: 'step', step: { kind: 'running_tool', name: 'read_url' } }
    )
    expect(r.activity).toEqual({ kind: 'running_tool', name: 'read_url' })
    expect(r.toolCalls).toEqual([{ name: 'web_search', result: 'r1' }]) // unchanged
  })
})
