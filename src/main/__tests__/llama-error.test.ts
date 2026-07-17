/**
 * Guards the llama-server failure classifier. The motivating bug: a shipped
 * build's bundled engine couldn't parse newer model archs and exited with
 * "unknown model architecture: 'gemma4'", but the app showed a blank
 * "Model installed but server is not running" — so it got misdiagnosed as a
 * code-signing problem for days. This maps the real stderr to a clear reason.
 */
import { describe, it, expect } from 'vitest'
import { classifyLlamaError } from '../llama-error'

describe('classifyLlamaError', () => {
  it('flags an engine too old for the model architecture (the reported bug)', () => {
    const stderr = `llama_model_load: error loading model: error loading model architecture: unknown model architecture: 'gemma4'
common_init_from_params: failed to load model 'gemma-4-E4B-it-Q4_K_M.gguf'
main: exiting due to model loading error`
    const f = classifyLlamaError(stderr)
    expect(f?.code).toBe('engine_outdated')
    expect(f?.reason).toMatch(/too old/i)
    expect(f?.reason).toMatch(/gemma4/) // names the offending arch
  })

  it('handles qwen35 too', () => {
    expect(classifyLlamaError("unknown model architecture: 'qwen35'")?.code).toBe('engine_outdated')
  })

  it('flags a macOS-too-old (dyld) failure', () => {
    expect(
      classifyLlamaError('dyld: ... was built for newer macOS version than being run')?.code
    ).toBe('os_too_old')
  })

  it('flags out-of-memory on load', () => {
    expect(
      classifyLlamaError('ggml_metal_buffer: failed to allocate buffer, size = 9216.00 MiB')?.code
    ).toBe('out_of_memory')
  })

  it('names the machine per platform in the OOM reason (Mac on macOS, device elsewhere)', () => {
    const oom = 'ggml_metal_buffer: failed to allocate buffer, size = 9216.00 MiB'
    expect(classifyLlamaError(oom, 'darwin')?.reason).toContain('too large for this Mac')
    expect(classifyLlamaError(oom, 'win32')?.reason).toContain('too large for this device')
    expect(classifyLlamaError(oom, 'linux')?.reason).toContain('too large for this device')
  })

  it('flags a missing dylib', () => {
    expect(classifyLlamaError('dyld: Library not loaded: @rpath/libomp.dylib')?.code).toBe(
      'missing_library'
    )
  })

  it('flags a corrupt model file', () => {
    expect(classifyLlamaError('gguf_init_from_file: invalid magic characters')?.code).toBe(
      'model_corrupt'
    )
  })

  it('returns null for healthy / unrecognized output (caller falls back)', () => {
    expect(classifyLlamaError('srv  load_model: loading model ... server is listening')).toBeNull()
    expect(classifyLlamaError('')).toBeNull()
  })
})
