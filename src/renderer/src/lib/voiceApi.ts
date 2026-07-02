// Minimal voice/dictation API for the core DictationOverlay.
// Uses only proInvoke / proOn from the core preload bridge — no pro-package import.
// The full API (recordings library, file transcription, settings) lives in
// pro/renderer/components/voice/voiceApi.ts for the pro VoiceScreen.

export type DictationState = 'idle' | 'recording' | 'transcribing';

export interface DictationSettings {
  accelerator: string;
  keyCode: number;
  modifier: string;
  mode: 'hold' | 'toggle' | 'both';
  interimMs: number;
  paste: boolean;
  appendSpace: boolean;
  ingest: boolean;
  customWords: string[];
  historyLimit: number;
  autoDeleteDays: number;
}

interface Bridge {
  proInvoke: (channel: string, ...args: unknown[]) => Promise<unknown>;
  proOn: (channel: string, cb: (...a: unknown[]) => void) => () => void;
}

function bridge(): Bridge | undefined {
  const api = (window as unknown as { api?: Bridge }).api;
  return api?.proInvoke ? api : undefined;
}

export interface VoiceOverlayApi {
  getState(): Promise<DictationState>;
  toggle(): Promise<void>;
  getSettings(): Promise<DictationSettings>;
  sendChunk(samples: Float32Array, sampleRate: number): Promise<void>;
  on(event: 'begin' | 'end' | 'interim' | 'final' | 'state' | 'error', cb: (payload: unknown) => void): () => void;
}

export function voice(): VoiceOverlayApi | undefined {
  const api = bridge();
  if (!api) return undefined;
  const inv = api.proInvoke;
  const on = api.proOn;
  return {
    getState: () => inv('voice:dictation:get-state') as Promise<DictationState>,
    toggle: () => inv('voice:dictation:toggle') as Promise<void>,
    getSettings: () => inv('voice:dictation:get-settings') as Promise<DictationSettings>,
    sendChunk: (samples, sampleRate) => inv('voice:dictation:chunk', samples, sampleRate) as Promise<void>,
    on: (event, cb) => on(`voice:dictation:${event}`, (payload) => cb(payload)),
  };
}
