import { describe, it, expect } from 'vitest';

// FUNCTIONAL integration test for the on-device AUDIO engines through the real gateway:
// TTS (kokoro, /v1/audio/speech) and STT (whisper/parakeet, /v1/audio/transcriptions).
// It does a ROUND-TRIP - synthesize speech from known text, then transcribe it back - so
// one test proves BOTH engines AND both gateway endpoints actually work end-to-end, not a
// mock. A round-trip is more honest than a hand-crafted audio fixture.
//
// Runs only when a gateway is reachable (a running app, or `npm run gateway`); SKIPS
// otherwise (plain CI has no engine) rather than failing. Point it elsewhere with
// OFFGRID_GATEWAY_URL.
const GW = process.env.OFFGRID_GATEWAY_URL ?? 'http://127.0.0.1:7878';
const UP = await fetch(`${GW}/v1/models`, { signal: AbortSignal.timeout(2000) })
  .then((r) => r.ok)
  .catch(() => false);

describe.skipIf(!UP)('audio engines round-trip (TTS -> STT) via the gateway', () => {
  const PHRASE = 'off grid';

  it('synthesizes speech (TTS) then transcribes it back to the same words (STT)', async () => {
    // 1. TTS: text -> WAV bytes.
    const ttsRes = await fetch(`${GW}/v1/audio/speech`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: PHRASE, voice: 'af_heart' }),
    });
    expect(ttsRes.ok).toBe(true);
    const wav = Buffer.from(await ttsRes.arrayBuffer());
    // A real WAV: RIFF header + non-trivial audio payload.
    expect(wav.length).toBeGreaterThan(1000);
    expect(wav.subarray(0, 4).toString('latin1')).toBe('RIFF');
    expect(wav.subarray(8, 12).toString('latin1')).toBe('WAVE');

    // 2. STT: WAV -> text (multipart, exactly as an OpenAI client would).
    const form = new FormData();
    form.append('file', new Blob([wav], { type: 'audio/wav' }), 'speech.wav');
    form.append('model', 'whisper');
    const sttRes = await fetch(`${GW}/v1/audio/transcriptions`, { method: 'POST', body: form });
    expect(sttRes.ok).toBe(true);
    const { text } = (await sttRes.json()) as { text: string };

    // The salient words survive the synth -> transcribe round-trip (tolerate case,
    // punctuation/hyphenation, and spacing differences between the engines).
    const norm = text.toLowerCase().replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ');
    expect(norm).toContain('off');
    expect(norm).toContain('grid');
  }, 180_000);
});
