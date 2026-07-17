import { GATEWAY_PORT, MEDIA_PORT } from './ports'

export function createRendererContentSecurityPolicy(styleNonce: string): string {
  const gatewayOrigin = `http://127.0.0.1:${GATEWAY_PORT}`
  const mediaOrigin = `http://127.0.0.1:${MEDIA_PORT}`
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${styleNonce}'`,
    `style-src 'self' 'nonce-${styleNonce}'`,
    `img-src 'self' data: blob: ogcapture: ${mediaOrigin} https://cdn.simpleicons.org`,
    `media-src 'self' data: blob: ogcapture: ${mediaOrigin}`,
    `frame-src 'self' ogartifact: ${gatewayOrigin} http://localhost:${GATEWAY_PORT}`,
    `connect-src 'self' ${gatewayOrigin} ${mediaOrigin}`
  ].join('; ')
}
