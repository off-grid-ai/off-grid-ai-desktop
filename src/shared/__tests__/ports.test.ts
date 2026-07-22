import { describe, it, expect } from 'vitest'
import { LLAMA_SERVER_PORT, GATEWAY_HOST, GATEWAY_PORT, MEDIA_PORT } from '../ports'

// DRY guard: these values are load-bearing (CSP allowlists, upstream proxy,
// gateway UI snippets). Assert the canonical numbers so a stray edit trips here.
describe('engine ports', () => {
  it('pins the llama-server port', () => {
    expect(LLAMA_SERVER_PORT).toBe(8439)
  })
  it('pins the gateway port', () => {
    expect(GATEWAY_PORT).toBe(7878)
  })
  it('pins the unauthenticated gateway to IPv4 loopback', () => {
    expect(GATEWAY_HOST).toBe('127.0.0.1')
  })
  it('pins the media server port', () => {
    expect(MEDIA_PORT).toBe(7879)
  })
})
