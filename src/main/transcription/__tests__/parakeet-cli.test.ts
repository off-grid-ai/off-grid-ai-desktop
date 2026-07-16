import { describe, it, expect } from 'vitest'
import {
  buildParakeetArgs,
  parseParakeetOutput,
  matchParakeetFiles,
  activeMatchesEntry,
  type ParakeetModel
} from '../parakeet-cli'

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
    expect(args).toContain('--decoding-method=greedy_search')
    expect(args[args.length - 1]).toBe('/tmp/a.wav') // positional wav is last
  })

  it('defaults the thread count', () => {
    expect(buildParakeetArgs(model, '/tmp/a.wav')).toContain('--num-threads=4')
  })

  it('does not pass a --model-type flag (sherpa infers transducer)', () => {
    // v1.13.3 has no --model-type; passing one errors. Regression guard.
    expect(buildParakeetArgs(model, '/tmp/a.wav').some((a) => a.startsWith('--model-type'))).toBe(
      false
    )
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

  it('parses REAL sherpa-onnx-offline v1.13.3 output (Parakeet TDT, captured on-device)', () => {
    // Verbatim stdout shape from the staged static binary: a JSON object whose FIRST
    // string keys are empty (lang/emotion/event) before "text". The parser must pick the
    // "text" field, not an earlier empty one, and keep punctuation/apostrophes.
    const real =
      '{"lang": "", "emotion": "", "event": "", "text": "Well, I don\'t wish to see it any more, observed Phebe, turning away her eyes.", "timestamps": [0.40, 0.64], "tokens": [" Well", ","], "words": []}'
    expect(parseParakeetOutput(real)).toBe(
      "Well, I don't wish to see it any more, observed Phebe, turning away her eyes."
    )
  })
})

describe('matchParakeetFiles', () => {
  it('picks the four roles from slug-prefixed catalog names', () => {
    const m = matchParakeetFiles([
      'parakeet-v2.encoder.int8.onnx',
      'parakeet-v2.decoder.int8.onnx',
      'parakeet-v2.joiner.int8.onnx',
      'parakeet-v2.tokens.txt'
    ])
    expect(m).toEqual({
      encoder: 'parakeet-v2.encoder.int8.onnx',
      decoder: 'parakeet-v2.decoder.int8.onnx',
      joiner: 'parakeet-v2.joiner.int8.onnx',
      tokens: 'parakeet-v2.tokens.txt'
    })
  })

  it('requires .onnx for the model parts and .txt for tokens', () => {
    // a stray "encoder" text file must not satisfy the encoder role
    expect(
      matchParakeetFiles(['encoder.txt', 'decoder.onnx', 'joiner.onnx', 'tokens.txt'])
    ).toBeNull()
  })

  it('returns null when a role is missing', () => {
    expect(matchParakeetFiles(['encoder.onnx', 'decoder.onnx', 'tokens.txt'])).toBeNull()
  })
})

describe('activeMatchesEntry', () => {
  const entry = {
    id: 'csukuangfj/parakeet-v2',
    files: [{ name: 'parakeet-v2.encoder.int8.onnx' }, { name: 'parakeet-v2.tokens.txt' }]
  }

  it('matches by catalog id', () => {
    expect(activeMatchesEntry('csukuangfj/parakeet-v2', entry)).toBe(true)
  })

  it('matches by a primary/on-disk filename (active-slot may store the filename)', () => {
    expect(activeMatchesEntry('parakeet-v2.encoder.int8.onnx', entry)).toBe(true)
  })

  it('does not match a different pick', () => {
    expect(activeMatchesEntry('ggml-base.bin', entry)).toBe(false)
  })

  it('returns false when nothing is active', () => {
    expect(activeMatchesEntry(null, entry)).toBe(false)
  })
})
