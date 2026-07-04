// The "working…" label shown while a chat turn is generating, before the first
// token lands. It MUST reflect the chat's memory scope: a plain (no-memory) chat
// never touches memory, so it must not claim to be "Searching your memory".
// Pure + UI-free so it's unit-testable.

export interface ChatScope {
  /** A project is active → retrieval is scoped to that project. */
  hasProject: boolean;
  /** No-memory ("plain chat") mode — no retrieval at all. */
  noMemory: boolean;
}

export function waitingLabel(scope: ChatScope): string {
  if (scope.hasProject) return 'Searching this project…';
  if (scope.noMemory) return 'Thinking…';
  return 'Searching your memory…';
}
