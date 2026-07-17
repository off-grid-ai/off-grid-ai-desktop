/**
 * Real HTTP integration for the local OpenAI-compatible gateway chat seam.
 *
 * The native llama-server process is the only fake: a loopback HTTP server speaks
 * its real SSE protocol on the production port. The production gateway must proxy
 * the first token before upstream completion, then preserve the rest of the stream.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import http from 'http'
import fs from 'fs'
import os from 'os'
import path from 'path'
import type { AddressInfo } from 'net'
import { LLAMA_SERVER_PORT } from '../../shared/ports'

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'offgrid-gateway-chat-'))

vi.mock('electron', () => ({
  app: {
    getPath: () => TMP_DIR,
    isPackaged: false,
    getAppPath: () => process.cwd(),
    getVersion: () => 'test'
  },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (value: string) => Buffer.from(value),
    decryptString: (value: Buffer) => value.toString()
  }
}))

import { startModelServer, stopModelServer } from '../model-server'

let upstream: http.Server
let gatewayPort: number
let releaseUpstream: (() => void) | undefined
let upstreamRequest: Record<string, unknown> | undefined

async function unusedPort(): Promise<number> {
  const probe = http.createServer()
  await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve))
  const port = (probe.address() as AddressInfo).port
  await new Promise<void>((resolve) => probe.close(() => resolve()))
  return port
}

async function waitForGateway(): Promise<void> {
  const deadline = Date.now() + 2_000
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${gatewayPort}/v1`)
      if (response.ok) return
    } catch {
      // The listen callback has not fired yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error('gateway did not start')
}

beforeAll(async () => {
  upstream = http.createServer((req, res) => {
    if (req.method !== 'POST' || req.url !== '/v1/chat/completions') {
      res.writeHead(404)
      res.end()
      return
    }

    let body = ''
    req.setEncoding('utf8')
    req.on('data', (chunk) => {
      body += chunk
    })
    req.on('end', async () => {
      upstreamRequest = JSON.parse(body) as Record<string, unknown>
      res.writeHead(200, { 'Content-Type': 'text/event-stream' })
      res.write('data: {"choices":[{"delta":{"content":"first"}}]}\n\n')
      await new Promise<void>((resolve) => {
        releaseUpstream = resolve
      })
      res.write('data: {"choices":[{"delta":{"content":" second"}}]}\n\n')
      res.end('data: [DONE]\n\n')
    })
  })
  await new Promise<void>((resolve, reject) => {
    upstream.once('error', reject)
    upstream.listen(LLAMA_SERVER_PORT, '127.0.0.1', () => resolve())
  })

  gatewayPort = await unusedPort()
  startModelServer(gatewayPort)
  await waitForGateway()
})

afterAll(async () => {
  releaseUpstream?.()
  stopModelServer()
  await new Promise<void>((resolve) => upstream.close(() => resolve()))
  fs.rmSync(TMP_DIR, { recursive: true, force: true })
})

describe('model gateway chat streaming', () => {
  it('forwards the real request and streams tokens before llama-server completes', async () => {
    const response = await fetch(`http://127.0.0.1:${gatewayPort}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'active',
        stream: true,
        messages: [{ role: 'user', content: 'Reply in two chunks' }]
      })
    })

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/event-stream')
    expect(response.headers.get('x-request-id')).toBeTruthy()

    const reader = response.body!.getReader()
    const first = new TextDecoder().decode((await reader.read()).value)
    expect(first).toContain('"content":"first"')
    expect(first).not.toContain('[DONE]')
    expect(upstreamRequest).toMatchObject({
      model: 'active',
      stream: true,
      messages: [{ role: 'user', content: 'Reply in two chunks' }]
    })

    releaseUpstream?.()
    let rest = ''
    for (;;) {
      const chunk = await reader.read()
      if (chunk.done) break
      rest += new TextDecoder().decode(chunk.value)
    }
    expect(rest).toContain('"content":" second"')
    expect(rest).toContain('data: [DONE]')
  })
})
