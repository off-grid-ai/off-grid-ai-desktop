/**
 * Unit tests for the pure SQL-predicate builders extracted from vectors.ts:
 * kindsPredicate (quote-escaping) + olderThanPredicate (floors the cutoff).
 * No LanceDB — pure import-and-assert.
 */
import { describe, it, expect } from 'vitest'
import { kindsPredicate, olderThanPredicate } from '../vectors-predicates'

describe('kindsPredicate — kind IN (...) with SQL-quote escaping', () => {
  it('builds a single-kind predicate', () => {
    expect(kindsPredicate(['screen'])).toBe("kind IN ('screen')")
  })

  it('builds a multi-kind predicate, comma-separated', () => {
    expect(kindsPredicate(['screen', 'meeting', 'memory'])).toBe(
      "kind IN ('screen', 'meeting', 'memory')"
    )
  })

  it("escapes a single quote in a kind by doubling it (' -> '')", () => {
    expect(kindsPredicate(["o'brien"])).toBe("kind IN ('o''brien')")
  })

  it('escapes every quote in a value', () => {
    expect(kindsPredicate(["a'b'c"])).toBe("kind IN ('a''b''c')")
  })

  it('an empty list yields an empty IN clause', () => {
    expect(kindsPredicate([])).toBe('kind IN ()')
  })
})

describe('olderThanPredicate — kinds AND floored cutoff', () => {
  it('appends the age filter with the cutoff floored to an integer', () => {
    expect(olderThanPredicate(['screen'], 1_700_000_000_123.9)).toBe(
      "kind IN ('screen') AND ts < 1700000000123"
    )
  })

  it('an integer cutoff is unchanged', () => {
    expect(olderThanPredicate(['meeting', 'memory'], 42)).toBe(
      "kind IN ('meeting', 'memory') AND ts < 42"
    )
  })

  it('reuses the same escaping as kindsPredicate', () => {
    expect(olderThanPredicate(["o'brien"], 10.99)).toBe("kind IN ('o''brien') AND ts < 10")
  })
})
