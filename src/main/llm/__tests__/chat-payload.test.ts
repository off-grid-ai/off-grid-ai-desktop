/**
 * Tests for the request-payload / message assembly - the single source of truth
 * used by both chat() and chatStream(). Covers: multimodal content parts with/without
 * images, mime detection, the system-message prepend rule, and the thinking-control
 * fragment on/off. Real inputs, no mocks.
 */

import { describe, it, expect } from 'vitest';
import { buildContentParts, buildMessages, imageMime, thinkingPayload, type DecodedImage } from '../chat-payload';

const PNG: DecodedImage = { base64: 'AAAA', mime: 'image/png' };
const JPG: DecodedImage = { base64: 'BBBB', mime: 'image/jpeg' };

describe('imageMime', () => {
  it('maps .png (any case) to image/png', () => {
    expect(imageMime('/a/b.png')).toBe('image/png');
    expect(imageMime('/a/B.PNG')).toBe('image/png');
  });
  it('maps everything else to image/jpeg', () => {
    expect(imageMime('/a/b.jpg')).toBe('image/jpeg');
    expect(imageMime('/a/b.jpeg')).toBe('image/jpeg');
    expect(imageMime('/a/b.webp')).toBe('image/jpeg');
    expect(imageMime('/a/noext')).toBe('image/jpeg');
  });
});

describe('buildContentParts', () => {
  it('text-only: a single text part', () => {
    expect(buildContentParts('hi', [])).toEqual([{ type: 'text', text: 'hi' }]);
  });

  it('one image: text part then an image_url data URI', () => {
    expect(buildContentParts('look', [PNG])).toEqual([
      { type: 'text', text: 'look' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } },
    ]);
  });

  it('preserves image order and uses each image mime', () => {
    const parts = buildContentParts('two', [PNG, JPG]);
    expect(parts).toEqual([
      { type: 'text', text: 'two' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } },
      { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,BBBB' } },
    ]);
  });
});

describe('buildMessages', () => {
  it('no system prompt: just the user turn', () => {
    const msgs = buildMessages('hi', [], '');
    expect(msgs).toEqual([{ role: 'user', content: [{ type: 'text', text: 'hi' }] }]);
  });

  it('blank/whitespace system prompt is NOT prepended (trim rule)', () => {
    const msgs = buildMessages('hi', [], '   \n  ');
    expect(msgs).toHaveLength(1);
    expect(msgs[0].role).toBe('user');
  });

  it('non-blank system prompt is unshifted in front of the user turn', () => {
    const msgs = buildMessages('hi', [], 'be terse');
    expect(msgs).toHaveLength(2);
    expect(msgs[0]).toEqual({ role: 'system', content: 'be terse' });
    expect(msgs[1].role).toBe('user');
  });

  it('user content carries the images', () => {
    const msgs = buildMessages('look', [JPG], '');
    expect(msgs[0].content).toEqual([
      { type: 'text', text: 'look' },
      { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,BBBB' } },
    ]);
  });
});

describe('thinkingPayload', () => {
  it('thinking ON: enable_thinking true + deepseek reasoning_format', () => {
    expect(thinkingPayload(true)).toEqual({
      chat_template_kwargs: { enable_thinking: true },
      reasoning_format: 'deepseek',
    });
  });

  it('thinking OFF: enable_thinking false, no reasoning_format', () => {
    expect(thinkingPayload(false)).toEqual({ chat_template_kwargs: { enable_thinking: false } });
  });
});
