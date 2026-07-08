import { describe, it, expect } from 'vitest';
import { parseMultipart } from '../multipart';

const CRLF = '\r\n';

/** Build a multipart body from parts (file: has filename; field: text only). */
function build(
  boundary: string,
  parts: { name: string; filename?: string; value: string }[]
): Buffer {
  const chunks: Buffer[] = [];
  for (const p of parts) {
    const disp = p.filename
      ? `Content-Disposition: form-data; name="${p.name}"; filename="${p.filename}"`
      : `Content-Disposition: form-data; name="${p.name}"`;
    chunks.push(Buffer.from(`--${boundary}${CRLF}${disp}${CRLF}${CRLF}${p.value}${CRLF}`));
  }
  chunks.push(Buffer.from(`--${boundary}--${CRLF}`));
  return Buffer.concat(chunks);
}

describe('parseMultipart', () => {
  it('returns empty when the content-type has no boundary', () => {
    expect(parseMultipart(Buffer.from('x'), 'multipart/form-data')).toEqual({ files: {}, fields: {} });
  });

  it('parses a single text field', () => {
    const body = build('BOUND', [{ name: 'prompt', value: 'a cat' }]);
    const { files, fields } = parseMultipart(body, 'multipart/form-data; boundary=BOUND');
    expect(fields).toEqual({ prompt: 'a cat' });
    expect(files).toEqual({});
  });

  it('parses a file part keyed by its field name', () => {
    const body = build('BOUND', [{ name: 'image', filename: 'a.png', value: 'BINARYDATA' }]);
    const { files, fields } = parseMultipart(body, 'multipart/form-data; boundary=BOUND');
    expect(fields).toEqual({});
    expect(files.image.filename).toBe('a.png');
    expect(files.image.data.toString('utf8')).toBe('BINARYDATA');
  });

  it('parses mixed files and fields', () => {
    const body = build('B', [
      { name: 'image', filename: 'i.jpg', value: 'IMG' },
      { name: 'prompt', value: 'hello' },
      { name: 'strength', value: '0.6' },
    ]);
    const { files, fields } = parseMultipart(body, 'multipart/form-data; boundary=B');
    expect(files.image.data.toString('utf8')).toBe('IMG');
    expect(fields).toEqual({ prompt: 'hello', strength: '0.6' });
  });

  it('reads a quoted boundary', () => {
    const body = build('QB', [{ name: 'x', value: 'v' }]);
    const { fields } = parseMultipart(body, 'multipart/form-data; boundary="QB"');
    expect(fields).toEqual({ x: 'v' });
  });

  it('keys a file by filename when the part has no name', () => {
    // Content-Disposition with filename but no name="..."
    const body = Buffer.concat([
      Buffer.from(`--B${CRLF}Content-Disposition: form-data; filename="only.png"${CRLF}${CRLF}DATA${CRLF}`),
      Buffer.from(`--B--${CRLF}`),
    ]);
    const { files } = parseMultipart(body, 'multipart/form-data; boundary=B');
    expect(files['only.png'].data.toString('utf8')).toBe('DATA');
  });

  it('preserves binary bytes in a file part exactly', () => {
    const raw = Buffer.from([0x00, 0xff, 0x10, 0x0d, 0x0a, 0x42]);
    const body = Buffer.concat([
      Buffer.from(`--B${CRLF}Content-Disposition: form-data; name="image"; filename="b.bin"${CRLF}${CRLF}`),
      raw,
      Buffer.from(`${CRLF}--B--${CRLF}`),
    ]);
    const { files } = parseMultipart(body, 'multipart/form-data; boundary=B');
    expect(Buffer.compare(files.image.data, raw)).toBe(0);
  });
});
