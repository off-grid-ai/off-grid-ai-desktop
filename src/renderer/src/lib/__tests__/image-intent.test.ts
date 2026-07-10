import { describe, it, expect } from 'vitest';
import { looksLikeImageRequest, cleanImagePrompt, shouldAutoRouteImage } from '../image-intent';

describe('looksLikeImageRequest', () => {
  it('detects bare visual verbs', () => {
    expect(looksLikeImageRequest('draw a dog')).toBe(true);
    expect(looksLikeImageRequest('paint a sunset over mountains')).toBe(true);
    expect(looksLikeImageRequest('sketch a robot')).toBe(true);
    expect(looksLikeImageRequest('illustrate a dragon')).toBe(true);
    expect(looksLikeImageRequest('Please draw a cat wearing a hat')).toBe(true);
  });

  it('detects weak verbs only with an image noun', () => {
    expect(looksLikeImageRequest('generate an image of a fox')).toBe(true);
    expect(looksLikeImageRequest('create a picture of a beach')).toBe(true);
    expect(looksLikeImageRequest('make a logo for my startup')).toBe(true);
    // weak verb, no image noun -> not an image request
    expect(looksLikeImageRequest('generate a summary of this')).toBe(false);
    expect(looksLikeImageRequest('create a plan for the week')).toBe(false);
  });

  it('detects "a picture of ..." without a leading verb', () => {
    expect(looksLikeImageRequest('an image of the eiffel tower at night')).toBe(true);
  });

  it('does NOT hijack non-visual "draw" idioms', () => {
    expect(looksLikeImageRequest('draw a conclusion from this data')).toBe(false);
    expect(looksLikeImageRequest('draw a comparison between the two')).toBe(false);
    expect(looksLikeImageRequest('draw attention to the risks')).toBe(false);
    expect(looksLikeImageRequest('draw inspiration from nature')).toBe(false);
  });

  it('ignores ordinary chat', () => {
    expect(looksLikeImageRequest('what is the capital of France?')).toBe(false);
    expect(looksLikeImageRequest('summarize my notes')).toBe(false);
    expect(looksLikeImageRequest('')).toBe(false);
  });
});

// The renderer's auto-route pre-decision. The bug it guards: when the agentic
// tools/connectors path owns the turn, image generation is a TOOL the model
// calls — the renderer must NOT pre-decide from a keyword and hijack the turn
// (that double decision routed "draw ..." away from the tool loop). Every branch:
describe('shouldAutoRouteImage', () => {
  const KEYWORD = 'draw a dog'; // looksLikeImageRequest === true
  const PLAIN = 'what is the capital of France?'; // looksLikeImageRequest === false

  it('auto-routes a keyword request in plain chat when an image model is available', () => {
    expect(shouldAutoRouteImage({ mode: 'chat', imageAvailable: true, agenticActive: false, text: KEYWORD })).toBe(true);
  });

  it('does NOT auto-route when the agentic path is active (the model owns image intent)', () => {
    // This is the fix: same keyword, but the agent decides — renderer stays out.
    expect(shouldAutoRouteImage({ mode: 'chat', imageAvailable: true, agenticActive: true, text: KEYWORD })).toBe(false);
  });

  it('does NOT auto-route in explicit image mode (the caller handles that path directly)', () => {
    expect(shouldAutoRouteImage({ mode: 'image', imageAvailable: true, agenticActive: false, text: KEYWORD })).toBe(false);
  });

  it('does NOT auto-route when no image model is available', () => {
    expect(shouldAutoRouteImage({ mode: 'chat', imageAvailable: false, agenticActive: false, text: KEYWORD })).toBe(false);
  });

  it('does NOT auto-route an ordinary chat message even with everything else enabled', () => {
    expect(shouldAutoRouteImage({ mode: 'chat', imageAvailable: true, agenticActive: false, text: PLAIN })).toBe(false);
  });

  it('agentic gate wins over the keyword regardless of image availability', () => {
    expect(shouldAutoRouteImage({ mode: 'chat', imageAvailable: true, agenticActive: true, text: PLAIN })).toBe(false);
  });
});

describe('cleanImagePrompt', () => {
  it('strips the leading generate-verb phrasing to leave the subject', () => {
    expect(cleanImagePrompt('draw a dog')).toBe('a dog');
    expect(cleanImagePrompt('generate an image of a fox in a forest')).toBe('a fox in a forest');
    expect(cleanImagePrompt('create a picture of a beach')).toBe('a beach');
    expect(cleanImagePrompt('paint a sunset')).toBe('a sunset');
  });

  it('falls back to the original when stripping would empty it', () => {
    expect(cleanImagePrompt('a lone red fox, cinematic')).toBe('a lone red fox, cinematic');
  });
});
