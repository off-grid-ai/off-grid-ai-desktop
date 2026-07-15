/**
 * Unit tests for the model-active decision logic. Guards the fix where ONLY the
 * chat LLM ever showed/activated — image/voice/transcription must light up when
 * their modality's chosen value matches (stored as id OR primary filename).
 *
 * active-models.ts pulls modelsDir from runtime-env (Electron-bound), so we mock
 * that to import the pure helpers without a real app.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../runtime-env', () => ({ modelsDir: () => '/tmp/models' }));

import { modalityForKind, isModelActive } from '../active-models';

const NONE = { image: null, speech: null, transcription: null } as const;

describe('modalityForKind', () => {
  it('maps non-chat kinds to a modality and chat/unknown kinds to null', () => {
    expect(modalityForKind('image')).toBe('image');
    expect(modalityForKind('voice')).toBe('speech');
    // Idempotent on the storage vocab too, so setActiveModalChoice accepts BOTH the
    // setup 'voice' AND the dispatched 'speech' (D26 — "Configure for me" passes
    // 'voice'; activateModel passes 'speech'; both must activate TTS).
    expect(modalityForKind('speech')).toBe('speech');
    expect(modalityForKind('transcription')).toBe('transcription');
    expect(modalityForKind('text')).toBeNull();
    expect(modalityForKind('vision')).toBeNull();
    expect(modalityForKind('local')).toBeNull();
    expect(modalityForKind(undefined)).toBeNull();
  });
});

describe('isModelActive', () => {
  it('text/vision/local match the active chat LLM id', () => {
    expect(isModelActive({ kind: 'text', id: 'a/x', activeChatId: 'a/x', modals: { ...NONE } })).toBe(true);
    expect(isModelActive({ kind: 'vision', id: 'a/x', activeChatId: 'b/y', modals: { ...NONE } })).toBe(false);
    expect(isModelActive({ kind: 'local', id: 'local:1', activeChatId: 'local:1', modals: { ...NONE } })).toBe(true);
  });

  it('image matches the chosen value by primary FILENAME (how image picks are stored)', () => {
    expect(isModelActive({ kind: 'image', id: 'org/jugg', primaryFile: 'jugg.gguf', activeChatId: null, modals: { ...NONE, image: 'jugg.gguf' } })).toBe(true);
    expect(isModelActive({ kind: 'image', id: 'org/jugg', primaryFile: 'jugg.gguf', activeChatId: null, modals: { ...NONE, image: 'other.gguf' } })).toBe(false);
  });

  it('voice/transcription match the chosen value by id (how those picks are stored)', () => {
    expect(isModelActive({ kind: 'voice', id: 'kokoro', activeChatId: null, modals: { ...NONE, speech: 'kokoro' } })).toBe(true);
    expect(isModelActive({ kind: 'transcription', id: 'whisper-small', activeChatId: null, modals: { ...NONE, transcription: 'whisper-small' } })).toBe(true);
  });

  it('a chat model is never "active" just because a modality pick exists', () => {
    expect(isModelActive({ kind: 'image', id: 'org/jugg', primaryFile: 'jugg.gguf', activeChatId: 'org/jugg', modals: { ...NONE } })).toBe(false);
  });
});
