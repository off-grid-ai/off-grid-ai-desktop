import { describe, it, expect } from 'vitest'
import { errBody, errMeta } from '../errors'

describe('errBody', () => {
  it('defaults the type to invalid_request_error', () => {
    expect(errBody('bad')).toEqual({ error: { message: 'bad', type: 'invalid_request_error' } })
  })

  it('uses a provided type', () => {
    expect(errBody('gone', 'not_found')).toEqual({ error: { message: 'gone', type: 'not_found' } })
  })
})

describe('errMeta', () => {
  it('defaults to 500 / server_error for an error with no status', () => {
    expect(errMeta(new Error('boom'))).toEqual({
      status: 500,
      type: 'server_error',
      message: 'boom'
    })
  })

  it('maps status 501 to not_installed', () => {
    const e = Object.assign(new Error('no model'), { status: 501 })
    expect(errMeta(e)).toEqual({ status: 501, type: 'not_installed', message: 'no model' })
  })

  it('maps status 502 to upstream_error', () => {
    const e = Object.assign(new Error('down'), { status: 502 })
    expect(errMeta(e)).toEqual({ status: 502, type: 'upstream_error', message: 'down' })
  })

  it('maps status 400 to invalid_request_error', () => {
    const e = Object.assign(new Error('bad req'), { status: 400 })
    expect(errMeta(e)).toEqual({ status: 400, type: 'invalid_request_error', message: 'bad req' })
  })

  it('maps any other status to server_error', () => {
    const e = Object.assign(new Error('teapot'), { status: 418 })
    expect(errMeta(e)).toEqual({ status: 418, type: 'server_error', message: 'teapot' })
  })

  it('stringifies a non-Error thrown value', () => {
    expect(errMeta('plain string')).toEqual({
      status: 500,
      type: 'server_error',
      message: 'plain string'
    })
  })

  it('handles undefined (defaults status 500, message "undefined")', () => {
    expect(errMeta(undefined)).toEqual({ status: 500, type: 'server_error', message: 'undefined' })
  })
})
