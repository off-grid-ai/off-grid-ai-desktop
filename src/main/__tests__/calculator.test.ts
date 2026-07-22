import { describe, expect, it } from 'vitest'
import { evaluateArithmetic } from '../calculator'

describe('evaluateArithmetic', () => {
  it.each([
    ['(3 + 4) * 2', 14],
    ['-2.5 + 10 / 4', 0],
    ['2 * -(3 + 1)', -8],
    ['.5 + .25', 0.75],
    ['2 ** 3', 8],
    ['2 ** 3 ** 2', 512],
    ['2 * 3 ** 2', 18]
  ])('evaluates %s', (expression, expected) => {
    expect(evaluateArithmetic(expression)).toBe(expected)
  })

  it.each(['', 'process.exit(1)', '2 *** 3', '1 + (2', '1 / 0', '1 2'])('rejects %s', (value) => {
    expect(() => evaluateArithmetic(value)).toThrow()
  })
})
