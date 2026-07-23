// @vitest-environment node
//
// Integration: the LLMService context CEILING is the model's TRAINED window (read from a real GGUF
// on disk), not our hardcoded default. Real fs, real GGUF bytes, real runtime-env — electron faked
// only for its path (the one OS boundary). Deleting the capContextToModel call in safeCtxSize makes
// the first assertion fail (the delete-the-impl guard).

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { configureRuntime } from '../runtime-env'

let TMP = ''
vi.mock('electron', () => ({
  app: {
    getPath: () => TMP,
    isPackaged: false,
    getAppPath: () => process.cwd()
  },
  safeStorage: { isEncryptionAvailable: () => false },
  BrowserWindow: { getAllWindows: () => [] }
}))

// --- minimal GGUF (v3) writer: magic | u32 ver | u64 tensors | u64 kv | KV* ---
const u32 = (n: number): Buffer => {
  const b = Buffer.alloc(4)
  b.writeUInt32LE(n)
  return b
}
const u64 = (n: number): Buffer => {
  const b = Buffer.alloc(8)
  b.writeBigUInt64LE(BigInt(n))
  return b
}
const gstr = (s: string): Buffer => Buffer.concat([u64(Buffer.byteLength(s)), Buffer.from(s, 'utf8')])
const kvString = (k: string, v: string): Buffer => Buffer.concat([gstr(k), u32(8), gstr(v)])
const kvU32 = (k: string, v: number): Buffer => Buffer.concat([gstr(k), u32(4), u32(v)])
const writeGguf = (p: string, arch: string, ctx: number): void => {
  const kvs = [kvString('general.architecture', arch), kvU32(`${arch}.context_length`, ctx)]
  // pad past GGUF_MIN_BYTES so isValidGgufFile/validateGguf also accept it if ever checked
  const pad = Buffer.alloc(2048)
  fs.writeFileSync(
    p,
    Buffer.concat([Buffer.from('GGUF', 'ascii'), u32(3), u64(0), u64(kvs.length), ...kvs, pad])
  )
}

let LLMService: typeof import('../llm').LLMService

beforeAll(async () => {
  TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'offgrid-ctx-ceiling-'))
  fs.mkdirSync(path.join(TMP, 'models'), { recursive: true })
  configureRuntime({ dataDir: TMP })
  ;({ LLMService } = await import('../llm'))
})

afterAll(() => {
  configureRuntime({ dataDir: undefined })
  fs.rmSync(TMP, { recursive: true, force: true })
})

function activate(fileName: string): void {
  fs.writeFileSync(
    path.join(TMP, 'models', 'active-model.json'),
    JSON.stringify({ primary: fileName })
  )
}

describe('LLMService context ceiling from GGUF', () => {
  it('caps the effective context to the trained window when it is below the default', () => {
    // Model trained to only 8192; the default ctx (16384) must be pulled DOWN to 8192.
    writeGguf(path.join(TMP, 'models', 'small.gguf'), 'llama', 8192)
    activate('small.gguf')

    const svc = new LLMService()
    expect(svc.modelMaxContext()).toBe(8192)
    // Effective is the trained window (RAM permits 8192 easily), NOT the 16384 default.
    expect(svc.effectiveContextSize()).toBe(8192)
  })

  it('does NOT cap below the model max when the model trained wider than the default', () => {
    // A 131072-trained model: our old hardcoded cap must not restrict it. The default request
    // (16384) is below the trained max, so the model imposes no cap — it passes through.
    writeGguf(path.join(TMP, 'models', 'big.gguf'), 'qwen3moe', 131072)
    activate('big.gguf')

    const svc = new LLMService()
    expect(svc.modelMaxContext()).toBe(131072)
    // The trained window does not pull the (smaller) requested context down.
    expect(svc.effectiveContextSize()).toBe(16384)
  })

  it('caps BELOW the RAM-clamp floor for a model trained under 2048 tokens', () => {
    // computeSafeCtx has a 2048-token floor; a model trained to only 1024 must still be capped to
    // 1024, never run at 2048 (the RAM floor must not exceed the trained ceiling).
    writeGguf(path.join(TMP, 'models', 'tiny.gguf'), 'llama', 1024)
    activate('tiny.gguf')
    const svc = new LLMService()
    expect(svc.modelMaxContext()).toBe(1024)
    expect(svc.effectiveContextSize()).toBe(1024)
  })

  it('reports an unknown max (null) and applies no model cap when the GGUF is unreadable', () => {
    activate('does-not-exist.gguf')
    const svc = new LLMService()
    expect(svc.modelMaxContext()).toBeNull()
  })
})
