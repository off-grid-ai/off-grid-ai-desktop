import { describe, it, expect } from 'vitest'
import { buildParakeetArgs, parseParakeetOutput, type ParakeetModel } from '../parakeet-cli'

const model: ParakeetModel = {
  dir: '/m',
  encoder: '/m/encoder.onnx',
  decoder: '/m/decoder.onnx',
  joiner: '/m/joiner.onnx',
  tokens: '/m/tokens.txt'
}

describe('buildParakeetArgs', () => {
  it('passes the four model files, thread count, and the wav last', () => {
    const args = buildParakeetArgs(model, '/tmp/a.wav', 6)
    expect(args).toContain('--encoder=/m/encoder.onnx')
    expect(args).toContain('--decoder=/m/decoder.onnx')
    expect(args).toContain('--joiner=/m/joiner.onnx')
    expect(args).toContain('--tokens=/m/tokens.txt')
    expect(args).toContain('--num-threads=6')
    expect(args[args.length - 1]).toBe('/tmp/a.wav') // positional wav is last
  })

  it('defaults the thread count', () => {
    expect(buildParakeetArgs(model, '/tmp/a.wav')).toContain('--num-threads=4')
  })
})

describe('parseParakeetOutput', () => {
  it('reads a JSON "text" field', () => {
    expect(parseParakeetOutput('{"text": "hello world"}')).toBe('hello world')
  })

  it('reads a text: line', () => {
    expect(parseParakeetOutput('/tmp/a.wav\ntext: hello there')).toBe('hello there')
  })

  it('reads a text= line', () => {
    expect(parseParakeetOutput('Done\ntext=quick brown fox')).toBe('quick brown fox')
  })

  it('prefers the JSON form when both appear', () => {
    expect(parseParakeetOutput('text: old\n{"text": "new"}')).toBe('new')
  })

  it('unescapes quotes and newlines in JSON text', () => {
    expect(parseParakeetOutput('{"text": "she said \\"hi\\"\\nbye"}')).toBe('she said "hi" bye')
  })

  it('takes the last text line when several are printed', () => {
    expect(parseParakeetOutput('text: first\ntext: second')).toBe('second')
  })

  it('returns empty string on unrecognized output', () => {
    expect(parseParakeetOutput('no transcript here')).toBe('')
  })
})
