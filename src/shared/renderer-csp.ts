export function createRendererContentSecurityPolicy(styleNonce: string): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${styleNonce}'`,
    `style-src 'self' 'nonce-${styleNonce}'`,
    "img-src 'self' data: blob: ogcapture: https://cdn.simpleicons.org",
    "media-src 'self' data: blob: ogcapture: http://127.0.0.1:7879",
    "frame-src 'self' ogartifact: http://127.0.0.1:7878 http://localhost:7878",
    "connect-src 'self' http://127.0.0.1:7878 http://127.0.0.1:7879"
  ].join('; ')
}
