// D15 — pressing Stop mid-round must NOT execute the tool the round assembled.
//
// The agentic loop's streamCompletion resolves with any partial tool_calls on
// abort (it doesn't reject), so a round the user cancelled still returned a tool
// call — and the loop ran it with no signal.aborted check. For an MCP action tool
// that means a real side effect (Slack message sent / calendar event created)
// fires AFTER the user hit Stop, and invisibly (the renderer already dropped the
// bubble). Product-correct: a cancelled turn fires no side effects.
//
// Integration over toolChat's real loop, faking only the true boundaries (the
// model engine llm.streamChat, the settings DB). A fake MCP-style extension
// records every execution; the terminal artifact is whether the action fired.
// The fake streamChat aborts the caller's signal mid-round (as Stop would) and
// returns a tool call. On HEAD the tool executes → red; with the abort check it
// does not → green.

import { describe, it, expect, beforeEach, vi } from 'vitest';

const { streamChatMock, initMock } = vi.hoisted(() => ({
  streamChatMock: vi.fn(),
  initMock: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../llm', () => ({ llm: { init: initMock, streamChat: streamChatMock, effectiveContextSize: () => 8192 } }));
const { getSettingMock, saveSettingMock } = vi.hoisted(() => ({ getSettingMock: vi.fn(() => [] as string[]), saveSettingMock: vi.fn() }));
vi.mock('../database', () => ({ getSetting: getSettingMock, saveSetting: saveSettingMock }));

import { toolChat, registerToolExtension } from '../tools';

describe('toolChat — a cancelled turn fires no tool side effects (D15)', () => {
  beforeEach(() => { streamChatMock.mockReset(); });

  it('does NOT run an MCP write tool when Stop aborts the round', async () => {
    const ctrl = new AbortController();
    const executed: string[] = [];

    // A fake MCP-style connector tool. execute() IS the side effect (a Slack send);
    // `executed` is the terminal artifact — did the action actually fire?
    registerToolExtension({
      id: 'test-mcp-d15',
      schemas: () => [{ type: 'function', function: { name: 'send_slack_message', description: 'send a message', parameters: { type: 'object', properties: {} } } }],
      canHandle: (n) => n === 'send_slack_message',
      execute: (n) => { executed.push(n); return 'sent'; },
    });

    let round = 0;
    streamChatMock.mockImplementation(async () => {
      round++;
      if (round === 1) {
        ctrl.abort(); // the user hits Stop DURING this round (as streamCompletion sees it)
        return { content: '', toolCalls: [{ id: 't1', name: 'send_slack_message', arguments: '{"text":"hi"}' }] };
      }
      return { content: 'done', toolCalls: [] }; // HEAD reaches a 2nd round after running the tool
    });

    await toolChat('post hi to slack', [], { connectors: true, signal: ctrl.signal, imageAvailable: false });

    // Terminal artifact: the Slack send never happened, because Stop was pressed.
    expect(executed).toEqual([]);
  });
});
