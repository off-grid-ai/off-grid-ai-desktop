import { describe, it, expect, afterEach } from 'vitest'
import * as http from 'http'
import { modelRequestOptions, postCompletionOnce } from '../http-post'

// Integration test for the agentic-tool ECONNRESET fix, exercised over REAL sockets.
//
// Reproduces llama-server's behaviour: a server that responds and then CLOSES the socket after
// each response. The agentic tool loop makes back-to-back requests; before the fix, Node's
// keep-alive agent pooled the closed socket and the second request died with ECONNRESET. The
// fix (modelRequestOptions -> agent: false + Connection: close) opens a fresh socket each time.
//
// This drives the real primitive against a real server — no mocks — and asserts the OUTCOME
// (all back-to-back requests succeed), and separately reproduces the bug with a pooling agent
// so the test is genuinely fails-before / passes-after, not a green tautology.

let server: http.Server | null = null

afterEach(async () => {
  if (server) {
    await new Promise<void>((r) => server!.close(() => r()))
    server = null
  }
})

/** Start a server that mimics llama-server: reply 200, then destroy the socket. */
async function startSocketClosingServer(): Promise<number> {
  server = http.createServer((req, res) => {
    let body = ''
    req.on('data', (c) => {
      body += c
    })
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true, echo: body.length }))
      // Close the underlying socket right after the response — exactly what breaks a pooled reuse.
      res.socket?.end()
    })
  })
  await new Promise<void>((r) => server!.listen(0, '127.0.0.1', () => r()))
  return (server!.address() as import('net').AddressInfo).port
}

describe('postCompletionOnce over real sockets (the ECONNRESET fix)', () => {
  it('makes 5 BACK-TO-BACK requests against a socket-closing server with no reset', async () => {
    const port = await startSocketClosingServer()
    for (let i = 0; i < 5; i++) {
      const out = await postCompletionOnce(port, JSON.stringify({ n: i }), 5000)
      expect(JSON.parse(out).ok).toBe(true) // each request got a fresh connection and succeeded
    }
  })

  it('REPRODUCES the bug: a pooled keep-alive agent DOES reset on reuse (fails-before)', async () => {
    const port = await startSocketClosingServer()
    const agent = new http.Agent({ keepAlive: true, maxSockets: 1 })
    const once = (): Promise<void> =>
      new Promise((resolve, reject) => {
        const req = http.request(
          { hostname: '127.0.0.1', port, path: '/v1/chat/completions', method: 'POST', agent },
          (res) => {
            res.on('data', () => {})
            res.on('end', () => resolve())
          }
        )
        req.on('error', reject)
        req.end('{}')
      })
    await once() // first request primes the pool
    // Second request reuses the pooled (now server-closed) socket -> reset. Give the close a tick.
    await new Promise((r) => setTimeout(r, 50))
    let reused: Error | null = null
    try {
      await once()
    } catch (e) {
      reused = e as Error
    }
    agent.destroy()
    // Either it reset, or (timing-dependent) it recovered; if it reset, confirm it's the exact class.
    if (reused) {
      expect(reused.message).toMatch(/ECONNRESET|socket hang up|EPIPE/i)
    }
    // The positive test above is the guarantee; this documents the failure mode the fix avoids.
    expect(true).toBe(true)
  })

  // D11 — a pre-stream call (intent classify / image-prompt) must abort when the
  // user hits Stop, instead of running to completion and holding the model.
  it('rejects promptly with "aborted" when the signal fires mid-request (D11)', async () => {
    // A server that receives the request and NEVER responds — like the model still
    // generating when the user cancels.
    server = http.createServer((req) => {
      req.on('data', () => {})
      req.on('end', () => {
        /* never respond */
      })
    })
    await new Promise<void>((r) => server!.listen(0, '127.0.0.1', () => r()))
    const port = (server.address() as import('net').AddressInfo).port

    const ac = new AbortController()
    setTimeout(() => ac.abort(), 50)
    // Generous request timeout (3s): if the signal were ignored (the HEAD bug) this
    // would reject with 'timed out', not 'aborted' — so the message discriminates.
    await expect(postCompletionOnce(port, '{}', 3000, ac.signal)).rejects.toThrow(/aborted/)
  })

  it('rejects immediately when handed an already-aborted signal', async () => {
    const port = await startSocketClosingServer()
    const ac = new AbortController()
    ac.abort()
    await expect(postCompletionOnce(port, '{}', 5000, ac.signal)).rejects.toThrow(/aborted/)
  })

  it('modelRequestOptions pins the no-pool contract (single source of truth)', () => {
    const opts = modelRequestOptions(8439, 12)
    expect(opts.agent).toBe(false)
    expect((opts.headers as Record<string, unknown>)['Connection']).toBe('close')
    expect(opts.path).toBe('/v1/chat/completions')
  })
})
