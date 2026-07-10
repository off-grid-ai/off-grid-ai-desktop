// Pure prompt-assembly helpers extracted from rag/index.ts so the project-chat
// prompt shape can be unit-tested without the RagService/llm/store IO. Behaviour
// is unchanged — index.ts imports these back.

export interface HistoryMessage {
  role: string;
  content: string;
}

/** Render the last 8 messages of a thread as "User:/Assistant:" lines. Returns
 *  '' for an empty thread so the caller can drop the block via filter(Boolean). */
export function formatHistory(messages: HistoryMessage[]): string {
  return messages
    .slice(-8)
    .map((m) => `${m.role === 'assistant' ? 'Assistant' : 'User'}: ${m.content}`)
    .join('\n');
}

/** Assemble the grounded project-chat prompt: system, retrieved context, prior
 *  conversation, the new user turn, and the "Assistant:" cue. Blank parts (no
 *  context, no history) are dropped, and the rest joined with blank lines. */
export function buildProjectPrompt(parts: {
  system: string;
  context: string;
  history: string;
  message: string;
}): string {
  const { system, context, history, message } = parts;
  return [
    system,
    context,
    history ? `Conversation so far:\n${history}` : '',
    `User: ${message}`,
    'Assistant:',
  ]
    .filter(Boolean)
    .join('\n\n');
}
