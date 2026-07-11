// Canonical engine ports - single source of truth for the loopback services.
// Change a port here and every site follows; do not re-hardcode these literals.
//
//   LLAMA_SERVER_PORT - bundled llama-server (chat/vision/embeddings upstream)
//   GATEWAY_PORT      - OpenAI-compatible gateway (proxies to llama-server)
//   MEDIA_PORT        - loopback media server (meeting recordings, uploads)
//
// Pure constants, no imports, so both the main process and the renderer can
// import this without pulling in Electron/Node.

export const LLAMA_SERVER_PORT = 8439;
export const GATEWAY_PORT = 7878;
export const MEDIA_PORT = 7879;
