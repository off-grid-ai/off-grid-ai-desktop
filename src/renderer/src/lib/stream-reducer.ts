// Pure reducer for a streaming chat message: given the message and one stream event,
// return the updated message. Extracted from the onRagStream handler so every arm —
// including tool_result (completed tool calls accumulate live + persist) — is unit-tested
// without mounting the chat.

export interface StreamEvent {
  type: 'content' | 'reasoning' | 'step' | 'tool_result'
  text?: string
  step?: unknown
  call?: { name: string; result: string }
}

export interface StreamedMessage {
  content?: string
  reasoning?: string
  toolCalls?: { name: string; result: string }[]
  activity?: unknown
}

export function applyStreamEvent<T extends StreamedMessage>(m: T, e: StreamEvent): T {
  if (e.type === 'content') {
    // Answer tokens clear the live "Running…" activity as the reply takes over.
    return { ...m, content: (m.content || '') + (e.text || ''), activity: undefined }
  }
  if (e.type === 'reasoning') {
    return { ...m, reasoning: (m.reasoning || '') + (e.text || '') }
  }
  if (e.type === 'tool_result' && e.call) {
    // Append the completed call so it + its result show live and survive as toolCalls.
    return { ...m, toolCalls: [...(m.toolCalls || []), e.call] }
  }
  // 'step' — the current live activity (Running <tool>…).
  return { ...m, activity: e.step }
}
