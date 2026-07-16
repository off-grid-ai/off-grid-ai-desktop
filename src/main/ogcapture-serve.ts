// Range-aware file serving for the ogcapture:// scheme, split out of index.ts so the fs
// reads sit behind a clear boundary: the protocol handler canonicalizes + allowlists the
// path, then hands the VALIDATED path here. Mirrors the loopback media-server's serveFile.
import fs from 'fs'
import { mimeForExt } from './mime'

/** ReadStream -> web ReadableStream that tears down SILENTLY on cancel (a seek/teardown):
 *  never call controller.error/close after a cancel, or Chromium treats the seek as a
 *  failed load and resets the player to 0:00. (net.fetch(file://) sidesteps this but
 *  doesn't honour Range, so seeking would be dead.) */
export function fileStreamToWeb(rs: fs.ReadStream): ReadableStream<Uint8Array> {
  let done = false
  return new ReadableStream<Uint8Array>({
    start(controller) {
      rs.on('data', (chunk: string | Buffer) => {
        if (done) return
        controller.enqueue(
          typeof chunk === 'string' ? new TextEncoder().encode(chunk) : new Uint8Array(chunk)
        )
        if ((controller.desiredSize ?? 1) <= 0) rs.pause()
      })
      rs.on('end', () => {
        if (!done) {
          done = true
          try {
            controller.close()
          } catch {
            /* closed */
          }
        }
      })
      rs.on('error', (err) => {
        if (!done) {
          done = true
          try {
            controller.error(err)
          } catch {
            /* errored */
          }
        }
      })
    },
    pull() {
      if (!done) rs.resume()
    },
    // Player cancelled (seek / teardown): kill the fd quietly, NEVER touch the controller.
    cancel() {
      done = true
      rs.destroy()
    }
  })
}

/** Serve `filePath` over ogcapture://, honouring an HTTP Range header. `filePath` MUST
 *  already be canonicalized + allowlisted by the caller (the protocol handler) — this does
 *  the fs reads on that validated path. Returns 416 for an unsatisfiable range, 404 on any
 *  fs error, 206 for a partial body, else 200. */
export async function serveCaptureFile(
  filePath: string,
  rangeHeader: string | null
): Promise<Response> {
  try {
    const stat = await fs.promises.stat(filePath)
    const size = stat.size
    const type = mimeForExt(filePath.split('.').pop()?.toLowerCase() ?? '')
    const m = rangeHeader && /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim())
    if (m && (m[1] || m[2])) {
      const start = m[1] ? parseInt(m[1], 10) : Math.max(0, size - parseInt(m[2]!, 10))
      const end = m[1] && m[2] ? Math.min(parseInt(m[2], 10), size - 1) : size - 1
      if (start >= size || start > end) {
        return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } })
      }
      const rs = fs.createReadStream(filePath, { start, end })
      return new Response(fileStreamToWeb(rs), {
        status: 206,
        headers: {
          'Content-Type': type,
          'Content-Length': String(end - start + 1),
          'Content-Range': `bytes ${start}-${end}/${size}`,
          'Accept-Ranges': 'bytes'
        }
      })
    }
    const rs = fs.createReadStream(filePath)
    return new Response(fileStreamToWeb(rs), {
      status: 200,
      headers: { 'Content-Type': type, 'Content-Length': String(size), 'Accept-Ranges': 'bytes' }
    })
  } catch (e) {
    console.error('[ogcapture] serve failed for', filePath, e)
    return new Response(null, { status: 404 })
  }
}
