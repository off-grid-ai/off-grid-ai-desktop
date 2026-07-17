const NUMBER = /^(?:\d+(?:\.\d*)?|\.\d+)/

class ArithmeticParser {
  private index = 0

  constructor(private readonly source: string) {}

  parse(): number {
    const value = this.expression()
    this.skipWhitespace()
    if (this.index !== this.source.length || !Number.isFinite(value)) {
      throw new Error('invalid arithmetic expression')
    }
    return value
  }

  private expression(): number {
    let value = this.term()
    for (;;) {
      if (this.consume('+')) value += this.term()
      else if (this.consume('-')) value -= this.term()
      else return value
    }
  }

  private term(): number {
    let value = this.factor()
    for (;;) {
      if (this.consume('*')) value *= this.factor()
      else if (this.consume('/')) value /= this.factor()
      else return value
    }
  }

  private factor(): number {
    if (this.consume('+')) return this.factor()
    if (this.consume('-')) return -this.factor()
    if (this.consume('(')) {
      const value = this.expression()
      if (!this.consume(')')) throw new Error('unclosed parenthesis')
      return value
    }

    this.skipWhitespace()
    const match = this.source.slice(this.index).match(NUMBER)
    if (!match) throw new Error('number expected')
    this.index += match[0].length
    return Number(match[0])
  }

  private consume(token: string): boolean {
    this.skipWhitespace()
    if (this.source[this.index] !== token) return false
    this.index += 1
    return true
  }

  private skipWhitespace(): void {
    while (/\s/.test(this.source[this.index] ?? '')) this.index += 1
  }
}

export function evaluateArithmetic(expression: string): number {
  return new ArithmeticParser(expression).parse()
}
