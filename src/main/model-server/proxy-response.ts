import type http from 'node:http'

function safeHeaderValue(value: string | string[] | undefined): string | undefined {
  if (typeof value !== 'string' || /[\r\n]/.test(value)) return undefined
  return value
}

/** Apply the response contract for the bundled llama-server.
 *
 * Redirects are never meaningful at this local proxy boundary, so a compromised
 * upstream cannot redirect a gateway client. Only representation metadata is
 * forwarded; hop-by-hop, cookie, location, and arbitrary object keys are dropped.
 */
export function safeProxyResponse(
  statusCode: number | undefined,
  upstream: http.IncomingHttpHeaders
): { statusCode: number; headers: http.OutgoingHttpHeaders } {
  const isRedirect = statusCode !== undefined && statusCode >= 300 && statusCode < 400
  const validStatus = statusCode !== undefined && statusCode >= 200 && statusCode <= 599
  const safeStatus = validStatus && !isRedirect ? statusCode : 502
  const headers: http.OutgoingHttpHeaders = {}

  const contentType = safeHeaderValue(upstream['content-type'])
  if (contentType) headers['content-type'] = contentType
  const contentLength = safeHeaderValue(upstream['content-length'])
  if (contentLength && /^\d+$/.test(contentLength)) headers['content-length'] = contentLength
  const contentEncoding = safeHeaderValue(upstream['content-encoding'])
  if (contentEncoding) headers['content-encoding'] = contentEncoding
  const cacheControl = safeHeaderValue(upstream['cache-control'])
  if (cacheControl) headers['cache-control'] = cacheControl

  return { statusCode: safeStatus, headers }
}
