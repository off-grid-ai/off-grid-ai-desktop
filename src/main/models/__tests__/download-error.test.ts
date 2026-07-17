import { describe, expect, it } from 'vitest'
import { downloadFailureMessage, NETWORK_UNAVAILABLE_MESSAGE } from '../download-error'

describe('downloadFailureMessage', () => {
  it.each(['ENOTFOUND', 'EAI_AGAIN', 'ENETUNREACH'])(
    'turns a nested %s fetch cause into an actionable offline message',
    (code) => {
      const cause = Object.assign(new Error('network lookup failed'), { code })
      const error = Object.assign(new TypeError('fetch failed'), { cause })

      expect(downloadFailureMessage(error)).toBe(NETWORK_UNAVAILABLE_MESSAGE)
    }
  )

  it('recognizes an offline code on the outer error', () => {
    const error = Object.assign(new Error('socket unavailable'), { code: 'ENETUNREACH' })

    expect(downloadFailureMessage(error)).toBe(NETWORK_UNAVAILABLE_MESSAGE)
  })

  it('preserves a specific non-network error', () => {
    expect(downloadFailureMessage(new Error('ENOSPC: no space left on device'))).toBe(
      'ENOSPC: no space left on device'
    )
  })

  it('preserves a non-Error thrown value as text', () => {
    expect(downloadFailureMessage('download stopped')).toBe('download stopped')
  })

  it('preserves a message carried by a non-Error object', () => {
    expect(downloadFailureMessage({ message: 'registry unavailable', status: 503 })).toBe(
      'registry unavailable'
    )
  })

  it('uses a stable fallback for anonymous or cyclic objects', () => {
    const cyclic: { self?: unknown } = {}
    cyclic.self = cyclic

    expect(downloadFailureMessage({ status: 503 })).toBe('Model download failed.')
    expect(downloadFailureMessage(cyclic)).toBe('Model download failed.')
  })
})
