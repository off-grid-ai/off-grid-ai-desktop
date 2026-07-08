// Canonical LLM inference defaults - single source of truth shared by the
// backend LLMService field defaults and the Settings UI (Reset to defaults).
//
// DEFAULT_CTX_SIZE is the context-window default. It matches the backend
// LLMService ctxSize field and the `balanced` MODE_PRESET, so a fresh instance
// and what the UI shows agree. Pure constants, no imports.

export const DEFAULT_CTX_SIZE = 16384;
