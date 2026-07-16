// Minimal multipart/form-data parser - pulls out uploaded file(s) + text fields
// (avoids adding a dependency for the upload endpoints). Keeps every file part
// keyed by its form field name so img2img can grab `image` specifically.
// Pure buffer transform, no I/O - extracted from model-server.ts for testing.
export function parseMultipart(
  body: Buffer,
  contentType: string
): { files: Record<string, { filename: string; data: Buffer }>; fields: Record<string, string> } {
  const out: {
    files: Record<string, { filename: string; data: Buffer }>
    fields: Record<string, string>
  } = {
    files: {},
    fields: {}
  }
  const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType)
  if (!m) return out
  const boundary = (m[1] || m[2])!.trim()
  const delim = Buffer.from('--' + boundary)
  const headSep = Buffer.from('\r\n\r\n')
  let pos = body.indexOf(delim)
  while (pos !== -1) {
    let partStart = pos + delim.length
    if (body[partStart] === 0x2d && body[partStart + 1] === 0x2d) break // closing "--"
    partStart += 2 // skip CRLF after boundary
    const next = body.indexOf(delim, partStart)
    if (next === -1) break
    const part = body.slice(partStart, next - 2) // drop trailing CRLF
    const sep = part.indexOf(headSep)
    if (sep !== -1) {
      const headers = part.slice(0, sep).toString('utf8')
      const content = part.slice(sep + headSep.length)
      const fileM = /filename="([^"]*)"/i.exec(headers)
      const nameM = /name="([^"]*)"/i.exec(headers)
      const field = nameM ? nameM[1] : ''
      if (fileM && fileM[1]) {
        out.files[field || fileM[1]] = { filename: fileM[1], data: content }
      } else if (field) {
        out.fields[field] = content.toString('utf8')
      }
    }
    pos = next
  }
  return out
}
