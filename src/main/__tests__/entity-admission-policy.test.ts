import { describe, expect, it } from 'vitest'
import { assessEntityCandidate } from '../entity-admission-policy'

describe('assessEntityCandidate', () => {
  it('normalizes the admitted candidate once for every implementation', () => {
    expect(
      assessEntityCandidate({
        name: '  Maya   Chen  ',
        type: '  Person ',
        partOf: '  Starling   Launch ',
        identifiers: [
          { kind: 'email', value: '  maya@example.test ' },
          { kind: 'handle', value: '   ' }
        ]
      })
    ).toEqual({
      admitted: true,
      candidate: {
        name: 'Maya Chen',
        type: 'Person',
        partOf: 'Starling Launch',
        identifiers: [{ kind: 'email', value: 'maya@example.test' }]
      }
    })
  })

  it('rejects an empty name before persistence', () => {
    expect(assessEntityCandidate({ name: '   ' })).toEqual({
      admitted: false,
      reason: 'empty-name'
    })
  })

  it('rejects a short OCR fragment before persistence', () => {
    expect(assessEntityCandidate({ name: 'AI' })).toEqual({
      admitted: false,
      reason: 'too-short'
    })
  })

  it.each([
    ['API', 'generic'],
    ['entity-domain.ts', 'file'],
    ['off-grid-ai/desktop', 'path-or-repository'],
    ['example.com', 'domain'],
    ['MemoryIngestSink', 'code-symbol'],
    ['desktop-pro', 'code-symbol']
  ] as const)('rejects pollution candidate %s as %s', (name, reason) => {
    expect(assessEntityCandidate({ name })).toEqual({ admitted: false, reason })
  })

  it('rejects the user by canonical name or an identifier alias', () => {
    const context = {
      selfAliases: ['Mohammed Ali', 'mac@example.test', '@alichherawalla']
    }
    expect(assessEntityCandidate({ name: '  mohammed   ali ' }, context)).toEqual({
      admitted: false,
      reason: 'self'
    })
    expect(
      assessEntityCandidate(
        {
          name: 'Mac',
          type: 'Person',
          identifiers: [{ kind: 'email', value: 'MAC@example.test' }]
        },
        context
      )
    ).toEqual({ admitted: false, reason: 'self' })
  })

  it('does not reject a real project merely because its name contains common words', () => {
    expect(assessEntityCandidate({ name: 'Off Grid AI Desktop', type: 'Project' })).toEqual({
      admitted: true,
      candidate: { name: 'Off Grid AI Desktop', type: 'Project' }
    })
  })
})
