import { describe, it, expect } from 'vitest'
import {
  classifyRef,
  decodeDataUrl,
  stripFileScheme,
  mimeFromExt,
  extForMime,
  toDataUrl
} from '../data-url'

describe('classifyRef', () => {
  it('classifies a data URL', () => {
    expect(classifyRef('data:image/png;base64,AAAA')).toBe('data')
  })

  it('classifies http and https URLs', () => {
    expect(classifyRef('http://example.com/a.png')).toBe('http')
    expect(classifyRef('https://example.com/a.png')).toBe('http')
  })

  it('classifies file:// and bare paths as file', () => {
    expect(classifyRef('file:///tmp/a.png')).toBe('file')
    expect(classifyRef('/tmp/a.png')).toBe('file')
    expect(classifyRef('relative/a.png')).toBe('file')
  })

  it('trims surrounding whitespace before classifying', () => {
    expect(classifyRef('  data:image/png;base64,AA  ')).toBe('data')
    expect(classifyRef('  https://x/y.png ')).toBe('http')
  })
})

describe('decodeDataUrl', () => {
  it('decodes a base64 data URL', () => {
    const url = 'data:image/png;base64,' + Buffer.from('hello').toString('base64')
    const { data, mime } = decodeDataUrl(url)
    expect(mime).toBe('image/png')
    expect(data.toString('utf8')).toBe('hello')
  })

  it('decodes a percent-encoded (non-base64) data URL', () => {
    const url = 'data:image/svg+xml,%3Csvg%3E'
    const { data, mime } = decodeDataUrl(url)
    expect(mime).toBe('image/svg+xml')
    expect(data.toString('utf8')).toBe('<svg>')
  })

  it('defaults the mime to image/png when absent', () => {
    const url = 'data:,plain'
    const { mime } = decodeDataUrl(url)
    expect(mime).toBe('image/png')
  })

  it('reads the declared mime for a jpeg data URL', () => {
    const url = 'data:image/jpeg;base64,' + Buffer.from('x').toString('base64')
    expect(decodeDataUrl(url).mime).toBe('image/jpeg')
  })
})

describe('stripFileScheme', () => {
  it('strips a file:// prefix', () => {
    expect(stripFileScheme('file:///tmp/a.png')).toBe('/tmp/a.png')
  })

  it('leaves a bare path unchanged', () => {
    expect(stripFileScheme('/tmp/a.png')).toBe('/tmp/a.png')
  })

  it('trims whitespace', () => {
    expect(stripFileScheme('  /tmp/a.png ')).toBe('/tmp/a.png')
  })
})

describe('mimeFromExt', () => {
  it('maps jpg and jpeg to image/jpeg', () => {
    expect(mimeFromExt('jpg')).toBe('image/jpeg')
    expect(mimeFromExt('jpeg')).toBe('image/jpeg')
    expect(mimeFromExt('JPG')).toBe('image/jpeg')
  })

  it('maps webp to image/webp', () => {
    expect(mimeFromExt('webp')).toBe('image/webp')
    expect(mimeFromExt('WEBP')).toBe('image/webp')
  })

  it('resolves gif to its real type (now the shared map is the source, not the png lump)', () => {
    // Previously gif fell into the png bucket (a wrong-MIME bug); the shared
    // ext->MIME map resolves it correctly.
    expect(mimeFromExt('gif')).toBe('image/gif')
  })

  it('resolves bmp/heic to their real types (accepted image uploads, now in the map)', () => {
    expect(mimeFromExt('bmp')).toBe('image/bmp')
    expect(mimeFromExt('heic')).toBe('image/heic')
  })

  it('falls back to image/png for png and a genuinely-unknown/empty ext', () => {
    expect(mimeFromExt('png')).toBe('image/png')
    expect(mimeFromExt('')).toBe('image/png')
    expect(mimeFromExt('tiff')).toBe('image/png')
  })
})

describe('extForMime', () => {
  it('maps a jpeg mime to .jpg', () => {
    expect(extForMime('image/jpeg')).toBe('.jpg')
  })

  it('maps a webp mime to .webp', () => {
    expect(extForMime('image/webp')).toBe('.webp')
  })

  it('falls back to .png for png and anything else', () => {
    expect(extForMime('image/png')).toBe('.png')
    expect(extForMime('application/octet-stream')).toBe('.png')
  })
})

describe('toDataUrl', () => {
  it('encodes bytes as a base64 data URL', () => {
    const url = toDataUrl(Buffer.from('hello'), 'image/png')
    expect(url).toBe('data:image/png;base64,' + Buffer.from('hello').toString('base64'))
  })

  it('round-trips through decodeDataUrl', () => {
    const bytes = Buffer.from([0, 1, 2, 255, 128])
    const url = toDataUrl(bytes, 'image/webp')
    const back = decodeDataUrl(url)
    expect(back.mime).toBe('image/webp')
    expect(Buffer.compare(back.data, bytes)).toBe(0)
  })
})
