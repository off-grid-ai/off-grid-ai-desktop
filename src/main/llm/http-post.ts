// The single source of truth for how we talk HTTP to the local model server, isolated from
// the electron-bound LLMService so it can be exercised by a real integration test.
//
// Why this exists: the agentic tool loop makes BACK-TO-BACK requests to llama-server. The
// server closes its socket after each response; Node's global keep-alive agent pools that
// socket, so the next request grabs a half-closed socket and the write fails with ECONNRESET.
// Single-shot chat never reused a socket, so only the multi-round tool loop broke. The fix is
// a FRESH connection per request (`agent: false` + `Connection: close`). This module defines
// that contract ONCE; every request site in llm.ts builds its options from here (DRY), and the
// integration test drives postCompletionOnce against a real socket-closing server (behaviour).

import * as http from 'http'

/** Turn a non-200 model-server response into an ACTIONABLE message. llama-server
 *  returns a JSON body like {"error":{"message":"request (22825 tokens) exceeds
 *  the available context size (16384 tokens) …"}}; the bare status code alone is
 *  useless to the user. We surface the common, user-fixable cases in plain
 *  language and otherwise fall back to the server's own message. */
export function describeServerError(statusCode: number | undefined, body: string): string {
  let detail = (body || '').trim()
  try {
    const j = JSON.parse(body)
    const m = j?.error?.message ?? j?.message
    if (typeof m === 'string' && m) detail = m
  } catch {
    /* non-JSON body — use the raw text */
  }
  // Context overflow — usually too many connectors enabled at once (their tool
  // schemas + grammar overflow the context window).
  if (/exceeds the available context size/i.test(detail)) {
    return 'The request is larger than the model’s context window — usually too many connectors enabled at once. Disable some connectors, or raise the context window in Settings, then try again.'
  }
  // A tool schema that can't be compiled into a valid grammar for the engine.
  if (/failed to (parse|initialize|compile) (grammar|json ?schema)/i.test(detail)) {
    return 'A connected tool’s schema couldn’t be turned into a valid grammar for the local model. Disable the most recently added connector and try again.'
  }
  return `LLM Server Error: ${statusCode ?? '?'}${detail ? ` ${detail}` : ''}`
}

/** The request options that guarantee a fresh, non-pooled connection to the model server.
 *  This is the contract that unbroke the tool loop — defined once, consumed everywhere. */
export function modelRequestOptions(port: number, contentLength: number): http.RequestOptions {
  return {
    hostname: '127.0.0.1',
    port,
    path: '/v1/chat/completions',
    method: 'POST',
    // Fresh connection per request — do NOT reuse a pooled keep-alive socket (the server
    // closes its socket after each response; a reused one is half-closed -> ECONNRESET).
    agent: false,
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': contentLength,
      Connection: 'close'
    }
  }
}

/** One non-streaming POST to /v1/chat/completions, resolving the raw body text. Rejects on a
 *  non-200, a transport error, a timeout, or an abort via `signal`. Electron-free so it can be
 *  integration-tested. The abort matters: a pre-stream call (intent classify / image-prompt)
 *  otherwise runs to completion after the user hits Stop, leaving the model busy and blocking
 *  the next turn. */
export function postCompletionOnce(
  port: number,
  body: string,
  timeoutMs: number,
  signal?: AbortSignal
): Promise<string> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('aborted'))
      return
    }
    let done = false
    const finish = (fn: () => void): void => {
      if (done) {
        return
      }
      done = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      fn()
    }
    const onAbort = (): void => {
      req.destroy()
      finish(() => reject(new Error('aborted')))
    }
    const timer = setTimeout(() => {
      req.destroy()
      finish(() => reject(new Error('LLM request timed out - try a shorter prompt')))
    }, timeoutMs)

    const req = http.request(modelRequestOptions(port, Buffer.byteLength(body)), (res) => {
      let data = ''
      res.on('data', (chunk) => {
        data += chunk
      })
      res.on('end', () =>
        finish(() => {
          if (res.statusCode !== 200) {
            reject(new Error(describeServerError(res.statusCode, data)))
            return
          }
          resolve(data)
        })
      )
    })
    req.on('error', (e) => finish(() => reject(e)))
    signal?.addEventListener('abort', onAbort, { once: true })
    req.write(body)
    req.end()
  })
}
