import { describe, it, expect } from 'vitest'
import { buildUserContent } from '../tool-content'

describe('buildUserContent', () => {
  it('returns a plain string when there are no images', () => {
    expect(buildUserContent('explain this', [])).toBe('explain this')
    expect(buildUserContent('hi')).toBe('hi')
  })

  it('returns a multimodal array (text + image_url) when images are attached', () => {
    // Regression: in tools/connectors mode the chat dropped image attachments —
    // the user turn was a plain string, so the vision model never saw the image.
    const out = buildUserContent('explain the image', [
      'data:image/png;base64,AAAA',
      'data:image/jpeg;base64,BBBB'
    ])
    expect(Array.isArray(out)).toBe(true)
    expect(out).toEqual([
      { type: 'text', text: 'explain the image' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } },
      { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,BBBB' } }
    ])
  })
})
