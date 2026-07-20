// @vitest-environment jsdom
/**
 * Release checklist #105 through the real rendered assistant action, TTS IPC handler,
 * persisted voice setting, synthesis service, subprocess protocol, and WAV validation.
 * The fake subprocess replaces only the heavyweight Kokoro/ONNX worker; Audio replaces
 * Chromium's media boundary. All Off Grid code between those boundaries stays production.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import '../src/renderer/src/__tests__/browser-boundaries.setup'
import {
  ChatBoundary,
  installBoundary,
  renderChat
} from '../src/renderer/src/components/__tests__/harness/chat-boundary'

type IpcHandler = (event: unknown, ...args: unknown[]) => unknown
const handlers = new Map<string, IpcHandler>()
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'offgrid-memory-chat-tts-'))
const dataDir = path.join(root, 'data')
const resourceDir = path.join(root, 'resources')
const failureMarker = path.join(root, 'fail-next-synthesis')
const inputRecord = path.join(root, 'worker-input.txt')
const voiceRecord = path.join(root, 'worker-voice.txt')
const originalDataDir = process.env.OFFGRID_DATA_DIR
const originalResourceDir = process.env.OFFGRID_RESOURCE_DIR
const originalFailureMarker = process.env.OFFGRID_TTS_TEST_FAILURE_MARKER
const originalInputRecord = process.env.OFFGRID_TTS_TEST_INPUT_RECORD
const originalVoiceRecord = process.env.OFFGRID_TTS_TEST_VOICE_RECORD

process.env.OFFGRID_DATA_DIR = dataDir
process.env.OFFGRID_RESOURCE_DIR = resourceDir
process.env.OFFGRID_TTS_TEST_FAILURE_MARKER = failureMarker
process.env.OFFGRID_TTS_TEST_INPUT_RECORD = inputRecord
process.env.OFFGRID_TTS_TEST_VOICE_RECORD = voiceRecord

vi.mock('electron', () => ({
  app: {
    getPath: () => dataDir,
    isPackaged: false,
    getAppPath: () => process.cwd()
  },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (value: string) => Buffer.from(value),
    decryptString: (value: Buffer) => value.toString()
  },
  ipcMain: {
    handle: (channel: string, handler: IpcHandler) => handlers.set(channel, handler)
  }
}))

const { getDB, saveSetting } = await import('../src/main/database')
const { setupTtsIpc } = await import('../src/main/tts-ipc')

interface AudioBoundary {
  src: string
  play: ReturnType<typeof vi.fn>
  pause: ReturnType<typeof vi.fn>
}

const audios: AudioBoundary[] = []

function setEnv(name: string, original: string | undefined): void {
  if (original === undefined) delete process.env[name]
  else process.env[name] = original
}

function installRealSpeechBridge(boundary: ChatBoundary): void {
  const handler = handlers.get('tts:speak')
  if (!handler) throw new Error('TTS IPC handler was not registered')
  ;(
    boundary.api as unknown as {
      speak: (text: string, voice?: string) => Promise<{ dataUrl: string }>
    }
  ).speak = (text, voice) => handler(undefined, text, voice) as Promise<{ dataUrl: string }>
  installBoundary(boundary)
}

beforeAll(() => {
  fs.mkdirSync(dataDir, { recursive: true })
  fs.mkdirSync(resourceDir, { recursive: true })
  fs.writeFileSync(
    path.join(resourceDir, 'tts-worker.mjs'),
    [
      "import fs from 'node:fs'",
      'const [, , command, output, voice] = process.argv',
      "let input = ''",
      "process.stdin.setEncoding('utf8')",
      "process.stdin.on('data', chunk => { input += chunk })",
      "process.stdin.on('end', () => {",
      "  if (fs.existsSync(process.env.OFFGRID_TTS_TEST_FAILURE_MARKER || '')) {",
      '    fs.rmSync(process.env.OFFGRID_TTS_TEST_FAILURE_MARKER, { force: true })',
      "    process.stderr.write('local speech model is unavailable')",
      '    return',
      '  }',
      "  if (command !== 'speak' || !output) return",
      '  fs.writeFileSync(process.env.OFFGRID_TTS_TEST_INPUT_RECORD, input)',
      "  fs.writeFileSync(process.env.OFFGRID_TTS_TEST_VOICE_RECORD, voice || '')",
      "  fs.writeFileSync(output, Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(60, 1)]))",
      '})'
    ].join('\n'),
    { mode: 0o755 }
  )
  setupTtsIpc()
  saveSetting('ttsVoice', 'af_bella')
})

beforeEach(() => {
  audios.length = 0
  fs.rmSync(failureMarker, { force: true })
  ;(Element.prototype as unknown as { scrollIntoView: () => void }).scrollIntoView = () => {}
  globalThis.requestAnimationFrame = (callback: FrameRequestCallback): number => {
    callback(0)
    return 1
  }
  vi.stubGlobal(
    'Audio',
    class implements AudioBoundary {
      error = null
      onended: (() => void) | null = null
      onerror: (() => void) | null = null
      play = vi.fn(async () => undefined)
      pause = vi.fn()

      constructor(readonly src: string) {
        audios.push(this)
      }
    }
  )
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

afterAll(() => {
  getDB().close()
  setEnv('OFFGRID_DATA_DIR', originalDataDir)
  setEnv('OFFGRID_RESOURCE_DIR', originalResourceDir)
  setEnv('OFFGRID_TTS_TEST_FAILURE_MARKER', originalFailureMarker)
  setEnv('OFFGRID_TTS_TEST_INPUT_RECORD', originalInputRecord)
  setEnv('OFFGRID_TTS_TEST_VOICE_RECORD', originalVoiceRecord)
  fs.rmSync(root, { recursive: true, force: true })
})

describe('assistant reply speech integration (#105)', () => {
  it('synthesizes and plays the rendered assistant reply through the real TTS contract', async () => {
    const boundary = new ChatBoundary()
    installRealSpeechBridge(boundary)
    const user = userEvent.setup()
    renderChat({ conversationId: 'conversation-b' })

    await user.click(await screen.findByRole('button', { name: 'Speak' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Stop' })).toBeTruthy())

    expect(audios).toHaveLength(1)
    expect(audios[0]!.play).toHaveBeenCalledOnce()
    const [metadata, encoded] = audios[0]!.src.split(',')
    expect(metadata).toBe('data:audio/wav;base64')
    expect(Buffer.from(encoded!, 'base64').subarray(0, 4).toString('ascii')).toBe('RIFF')
    expect(fs.readFileSync(inputRecord, 'utf8')).toBe('Conversation B baseline')
    expect(fs.readFileSync(voiceRecord, 'utf8')).toBe('af_bella')
  })

  it('surfaces a real synthesis failure as an actionable rendered error', async () => {
    fs.writeFileSync(failureMarker, 'fail')
    const boundary = new ChatBoundary()
    installRealSpeechBridge(boundary)
    const user = userEvent.setup()
    renderChat({ conversationId: 'conversation-b' })

    await user.click(await screen.findByRole('button', { name: 'Speak' }))

    expect((await screen.findByRole('alert')).textContent).toMatch(
      /speech could not be generated.*text-to-speech is installed in settings/i
    )
    expect(audios).toHaveLength(0)
    expect(screen.getByRole('button', { name: 'Speak' })).toBeTruthy()
  })
})
