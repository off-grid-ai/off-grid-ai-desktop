import { describe, it, expect, afterEach } from 'vitest'
import { streamCompletion } from '../llm/stream'
import { startFakeLlamaServer, type FakeLlamaServer } from './harness/fake-llama-server'

// Integration test over a REAL socket (the fake llama-server) for the abort-at-entry path in
// streamCompletion. The tool loop REUSES one AbortSignal across every round, so a later round
// can begin with signal.aborted already true (the user hit Stop during the previous round).
// streamCompletion must honor that at entry: resolve with the empty result and never open a
// doomed write on a request it immediately destroys. No mock of our code — the real primitive
// runs against a real server that WOULD stream content if reached.

let server: FakeLlamaServer | null = null
afterEach(async () => {
  if (server) {
    await server.close()
    server = null
  }
})

describe('streamCompletion honors an already-aborted signal at entry', () => {
  it('resolves empty and sends nothing when the signal is already aborted before the call', async () => {
    server = await startFakeLlamaServer()
    server.enqueue({ content: 'this answer must never stream' })
    const controller = new AbortController()
    controller.abort() // aborted BEFORE streamCompletion runs (a reused, already-cancelled signal)

    const deltas: string[] = []
    const res = await streamCompletion(
      server.port,
      JSON.stringify({ stream: true, messages: [{ role: 'user', content: 'hi' }] }),
      (t) => deltas.push(t),
      { timeoutMs: 5000, signal: controller.signal }
    )

    // Abort honored at entry: nothing streamed to the caller...
    expect(res.content).toBe('')
    expect(res.toolCalls).toEqual([])
    expect(deltas).toEqual([])
    // ...and the request never reached the engine (no doomed write on the destroyed request).
    expect(server.requests.length).toBe(0)
  })

  it('still streams normally when the signal is NOT aborted (guard is not over-broad)', async () => {
    server = await startFakeLlamaServer()
    server.enqueue({ content: 'hello world' })
    const controller = new AbortController() // live, never aborted

    const res = await streamCompletion(
      server.port,
      JSON.stringify({ stream: true, messages: [{ role: 'user', content: 'hi' }] }),
      () => {},
      { timeoutMs: 5000, signal: controller.signal }
    )

    expect(res.content).toBe('hello world') // the round-trip works when not aborted
    expect(server.requests.length).toBe(1)
  })
})
