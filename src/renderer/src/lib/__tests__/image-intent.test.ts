import { describe, it, expect } from 'vitest';
import { looksLikeImageRequest, cleanImagePrompt } from '../image-intent';

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
