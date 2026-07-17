// Main-process adjacent evidence for RELEASE_TEST_CHECKLIST #49. This owns the real
// persisted-settings -> fresh LLMService -> loopback native-model socket -> production SSE
// parser chain. The paired renderer test owns the public preload event -> visible chat path.
// Neither test claims the missing visible cutoff state for `finish_reason: "length"`.

import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { startFakeLlamaServer } from '../../__tests__/harness/fake-llama-server'

const OLD_MAX_TOKENS = 2048
const RAISED_MAX_TOKENS = 4096

describe('persisted response limit over the production local stream', () => {
  it('loads the raised cap in a fresh service and streams beyond the old cap', async () => {
    const originalDataDir = process.env.OFFGRID_DATA_DIR
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'offgrid-response-limit-'))
    fs.mkdirSync(path.join(dataDir, 'models'), { recursive: true })
    process.env.OFFGRID_DATA_DIR = dataDir
    const fake = await startFakeLlamaServer()

    try {
      const { LLMService } = await import('../../llm')
      const settingsOwner = new LLMService()
      await settingsOwner.setSettings({ maxTokens: RAISED_MAX_TOKENS })

      const settingsPath = path.join(dataDir, 'models', 'llm-settings.json')
      expect(JSON.parse(fs.readFileSync(settingsPath, 'utf8')).maxTokens).toBe(RAISED_MAX_TOKENS)

      // Reload from disk so this request cannot pass by retaining the setter's in-memory state.
      const reloaded = new LLMService()
      expect(reloaded.getSettings().maxTokens).toBe(RAISED_MAX_TOKENS)
      const runtime = reloaded as unknown as {
        port: number
        initialized: boolean
        paused: boolean
      }
      runtime.port = fake.port
      runtime.initialized = true
      runtime.paused = false

      const nativeTokenDeltas = Array.from({ length: OLD_MAX_TOKENS + 2 }, (_, index) =>
        index === OLD_MAX_TOKENS + 1 ? ' LIMIT-END' : 'x'
      )
      fake.enqueue({ contentDeltas: nativeTokenDeltas })
      const streamed: string[] = []
      const answer = await reloaded.chatStream('Write a long answer', [], (text, kind) => {
        if (kind === 'content') streamed.push(text)
      })

      expect(fake.requests).toHaveLength(1)
      expect(fake.requests[0]!.max_tokens).toBe(RAISED_MAX_TOKENS)
      expect(streamed).toHaveLength(OLD_MAX_TOKENS + 2)
      expect(streamed.join('')).toBe(answer)
      expect(answer).toMatch(/LIMIT-END$/)
    } finally {
      await fake.close()
      fs.rmSync(dataDir, { recursive: true, force: true })
      if (originalDataDir === undefined) delete process.env.OFFGRID_DATA_DIR
      else process.env.OFFGRID_DATA_DIR = originalDataDir
    }
  })
})
