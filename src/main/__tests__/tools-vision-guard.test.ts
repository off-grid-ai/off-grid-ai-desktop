// D16 — an attached image must only be sent to the model when the ACTIVE model can
// actually read it. toolChat embedded image_url parts unconditionally (the vision
// gate lived only in the renderer, fetched once per mount and stale). A text-only
// model then got parts it can't process → silent wrong answer or an engine error.
// Main must be the single source of truth via llm.hasVision().
//
// Integration over toolChat's real message-building, faking only the boundaries
// (model engine + settings DB). We capture the messages sent to the engine (the
// terminal artifact at that boundary) and assert the image is embedded only when
// hasVision() is true. Crossed over BOTH values of the vision axis — the bug hid
// because the suite only ever ran the vision-present default.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

const { streamChatMock, initMock, hasVisionMock } = vi.hoisted(() => ({
  streamChatMock: vi.fn(),
  initMock: vi.fn().mockResolvedValue(undefined),
  hasVisionMock: vi.fn(() => false),
}));
vi.mock('../llm', () => ({ llm: { init: initMock, streamChat: streamChatMock, hasVision: hasVisionMock } }));
const { getSettingMock, saveSettingMock } = vi.hoisted(() => ({ getSettingMock: vi.fn(() => [] as string[]), saveSettingMock: vi.fn() }));
vi.mock('../database', () => ({ getSetting: getSettingMock, saveSetting: saveSettingMock }));

import { toolChat } from '../tools';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'offgrid-vis-'));
const imgPath = path.join(TMP, 'shot.png');
fs.writeFileSync(imgPath, Buffer.from([0x89, 0x50, 0x4e, 0x47])); // bytes irrelevant; the .png ext drives the mime

type Part = { type: string; image_url?: { url: string } };
function userContentOf(messages: { role: string; content: unknown }[]): unknown {
  return messages[messages.length - 1]!.content;
}

describe('toolChat vision guard (D16)', () => {
  let captured: { role: string; content: unknown }[] = [];
  beforeEach(() => {
    streamChatMock.mockReset();
    streamChatMock.mockImplementation(async (messages: { role: string; content: unknown }[]) => {
      captured = messages;
      return { content: 'ok', toolCalls: [] };
    });
  });

  it('does NOT embed the image when the active model has no vision', async () => {
    hasVisionMock.mockReturnValue(false);
    await toolChat('what is in this image?', [], { images: [imgPath], imageAvailable: false });

    // Terminal artifact at the engine boundary: a plain-text user turn, no image_url.
    const content = userContentOf(captured);
    expect(typeof content).toBe('string');
    expect(JSON.stringify(content)).not.toContain('image_url');
  });

  it('embeds the image when the active model HAS vision', async () => {
    hasVisionMock.mockReturnValue(true);
    await toolChat('what is in this image?', [], { images: [imgPath], imageAvailable: false });

    const content = userContentOf(captured) as Part[];
    expect(Array.isArray(content)).toBe(true);
    expect(content.some((p) => p.type === 'image_url')).toBe(true);
  });
});
