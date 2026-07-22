// Whether the agentic tool loop owns a chat turn: purely whether the user enabled Tools
// or Connectors in the composer. Deliberately NOT gated by project — agentic tools run
// in project chats too. (A past `&& !projectId` gate silently disabled Tools/Connectors
// inside projects, so the model faked "(Simulating use of web search tools)" instead of
// actually calling them.) Kept as a one-line pure function so a regression test can lock
// out re-adding a project gate.
export function isAgenticTurn(opts: { toolsOn: boolean; connectorsOn: boolean }): boolean {
  return opts.toolsOn || opts.connectorsOn
}
