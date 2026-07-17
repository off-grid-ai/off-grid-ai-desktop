import { describe, expect, it } from 'vitest'
import type http from 'node:http'
import { safeProxyResponse } from '../proxy-response'

describe('safeProxyResponse', () => {
  it('keeps representation metadata and normal upstream errors', () => {
    expect(
      safeProxyResponse(429, {
        'content-type': 'application/json',
        'content-length': '42',
        'content-encoding': 'gzip',
        'cache-control': 'no-store'
      })
    ).toEqual({
      statusCode: 429,
      headers: {
        'content-type': 'application/json',
        'content-length': '42',
        'content-encoding': 'gzip',
        'cache-control': 'no-store'
      }
    })
  })

  it('turns redirects into a gateway failure and drops unsafe response headers', () => {
    const upstream = Object.create(null) as http.IncomingHttpHeaders
    upstream.location = 'https://attacker.invalid'
    upstream['set-cookie'] = ['session=stolen']
    upstream.connection = 'upgrade'
    Object.defineProperty(upstream, '__proto__', {
      value: 'polluted',
      enumerable: true
    })

    expect(safeProxyResponse(302, upstream)).toEqual({ statusCode: 502, headers: {} })
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined()
  })

  it('drops malformed or ambiguous representation headers', () => {
    expect(
      safeProxyResponse(undefined, {
        'content-type': 'text/event-stream\r\nx-injected: true',
        'content-length': '-1',
        'content-encoding': 'gzip\r\nx-injected: true'
      })
    ).toEqual({ statusCode: 502, headers: {} })
  })
})
