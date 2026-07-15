import { describe, it, expect, beforeEach, vi } from 'vitest';

// INTERIM — the agentic tool loop is now covered as a REAL integration test in
// tools-loop.dbtest.ts (real toolChat + real LLMService over a fake llama socket + real
// DB, no mocked code). The ONLY cases left here are the search_memory citation
// side-channel. Converting these to real is a bigger harness job than the rest:
// universalSearch spans the FULL app schema — CORE FTS tables (summary_fts, entity_fts, …)
// AND PRO-created ones (observations/observation_fts), plus lancedb vectors + the
// @xenova/transformers embedding model. A faithful test needs the whole core+pro schema
// bootstrapped with the embedding leaf faked (logged in docs/GAPS_BACKLOG.md). Until then
// these keep the loop's citation dedup/empty paths under test via a faked search leaf —
// the ONE remaining our-code mock. Everything else moved to tools-loop.dbtest.ts (real).
const { streamChatMock, initMock } = vi.hoisted(() => ({
  streamChatMock: vi.fn(),
  initMock: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../llm', () => ({ llm: { init: initMock, streamChat: streamChatMock, effectiveContextSize: () => 8192 } }));
const { getSettingMock, saveSettingMock } = vi.hoisted(() => ({ getSettingMock: vi.fn(() => [] as string[]), saveSettingMock: vi.fn() }));
vi.mock('../database', () => ({ getSetting: getSettingMock, saveSetting: saveSettingMock }));
const { searchMock } = vi.hoisted(() => ({ searchMock: vi.fn() }));
vi.mock('../search', () => ({ universalSearch: searchMock }));

import { toolChat } from '../tools';

type Hit = { key: string; kind: string; refId: number; title: string; snippet: string; surface: string; ts: number; imagePath: string | null };
const hit = (key: string, over: Partial<Hit> = {}): Hit => ({ key, kind: 'memory', refId: 1, title: key, snippet: 's', surface: 'Note', ts: 1, imagePath: null, ...over });

function scriptToolThenAnswer(name: string, args: string, answer: string): void {
  streamChatMock.mockImplementationOnce(async () => ({ content: '', toolCalls: [{ id: 'c', name, arguments: args }] }));
  streamChatMock.mockImplementationOnce(async () => ({ content: answer, toolCalls: [] }));
}

describe('search_memory citation side-channel (INTERIM — pending real-universalSearch conversion)', () => {
  beforeEach(() => { streamChatMock.mockReset(); });

  it('surfaces search_memory hits as structured citations in r.unified, excluding the current chat', async () => {
    searchMock.mockReset();
    searchMock.mockResolvedValueOnce([hit('mem:1', { title: 'Q3 launch', snippet: 'shipped', surface: 'Note', ts: 1_700_000_000_000 })]);
    scriptToolThenAnswer('search_memory', '{"query":"Q3 launch"}', 'You shipped the Q3 launch.');
    const r = await toolChat('what about Q3', [], { conversationId: 'chat-current' });

    expect(r.unified).toHaveLength(1);
    expect(r.unified[0]).toMatchObject({ key: 'mem:1', title: 'Q3 launch', surface: 'Note' });
    expect(r.answer).toBe('You shipped the Q3 launch.');
    expect(searchMock).toHaveBeenCalledWith('Q3 launch', expect.objectContaining({ excludeChatId: 'chat-current' }));
  });

  it('dedups citations across multiple search_memory rounds by key (dynamic per-round hits)', async () => {
    searchMock.mockReset();
    searchMock
      .mockResolvedValueOnce([hit('k1')])
      .mockResolvedValueOnce([hit('k1'), hit('k2')]);
    streamChatMock.mockImplementationOnce(async () => ({ content: '', toolCalls: [{ id: 'c1', name: 'search_memory', arguments: '{"query":"a"}' }] }));
    streamChatMock.mockImplementationOnce(async () => ({ content: '', toolCalls: [{ id: 'c2', name: 'search_memory', arguments: '{"query":"b"}' }] }));
    streamChatMock.mockImplementationOnce(async () => ({ content: 'done', toolCalls: [] }));
    const r = await toolChat('dig deeper', []);
    expect(r.unified.map((s) => s.key)).toEqual(['k1', 'k2']);
  });

  it('search_memory with no hits yields the empty-memory text and no citations', async () => {
    searchMock.mockReset();
    searchMock.mockResolvedValueOnce([]);
    scriptToolThenAnswer('search_memory', '{"query":"nothing"}', 'I could not find anything.');
    const r = await toolChat('anything?', []);
    expect(r.unified).toEqual([]);
    expect(r.toolCalls[0]!.result).toMatch(/nothing found in memory/i);
  });
});
