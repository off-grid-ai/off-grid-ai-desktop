import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the connector I/O boundary (native/DB) and the pro approval hook so the
// pure ToolExtension logic — action classification, name namespacing, truncation,
// approval routing — runs in-process against fakes.
const listConnectors = vi.fn();
const fetchTools = vi.fn();
const callConnectorTool = vi.fn();
const callHook = vi.fn();

vi.mock('../../mcp', () => ({
  listConnectors: () => listConnectors(),
  fetchTools: (id: number) => fetchTools(id),
  callConnectorTool: (id: number, tool: string, args: unknown) => callConnectorTool(id, tool, args),
}));
vi.mock('../../bootstrap/hookRegistry', () => ({
  callHook: (name: string, payload: unknown) => callHook(name, payload),
}));

import { isActionTool, mcpConnectorToolExtension } from '../mcpConnectorToolExtension';

describe('isActionTool', () => {
  it.each(['list_channels', 'get_user', 'search_docs', 'read_file', 'fetch_url', 'whoami_now', 'describe_table'])(
    'treats read-verb tool %s as a non-action (no approval)',
    (tool) => {
      expect(isActionTool(tool)).toBe(false);
    },
  );

  it('requires a separator after the read verb (bare whoami has none, so it is an action)', () => {
    // The regex is anchored as `^<verb>[_-]`; a bare verb with no separator does not match.
    expect(isActionTool('whoami')).toBe(true);
  });

  it.each(['send_message', 'create_issue', 'delete_record', 'update_row', 'post_comment'])(
    'treats write-verb tool %s as an action (needs approval)',
    (tool) => {
      expect(isActionTool(tool)).toBe(true);
    },
  );

  it('matches the read verb case-insensitively and with a hyphen separator', () => {
    expect(isActionTool('LIST-things')).toBe(false);
    expect(isActionTool('Get-Thing')).toBe(false);
  });

  it('does not treat a read verb embedded mid-name as a read (prefix-anchored)', () => {
    // "getter" has no separator after "get"; "unlist_x" does not start with a read verb.
    expect(isActionTool('getter_run')).toBe(true);
    expect(isActionTool('unlist_item')).toBe(true);
  });
});

describe('McpConnectorToolExtension', () => {
  beforeEach(() => {
    listConnectors.mockReset();
    fetchTools.mockReset();
    callConnectorTool.mockReset();
    callHook.mockReset();
    callHook.mockReturnValue(false);
  });

  describe('canHandle', () => {
    it('owns only mcp__-prefixed tool names', () => {
      expect(mcpConnectorToolExtension.canHandle('mcp__3__list_x')).toBe(true);
      expect(mcpConnectorToolExtension.canHandle('generate_image')).toBe(false);
      expect(mcpConnectorToolExtension.canHandle('mcp_3_list_x')).toBe(false);
    });
  });

  describe('schemas', () => {
    it('namespaces each enabled connector tool as mcp__<id>__<tool> and prefixes the description', async () => {
      listConnectors.mockReturnValue([
        { id: 7, name: 'Slack', enabled: true },
        { id: 9, name: 'Off', enabled: false },
      ]);
      fetchTools.mockResolvedValue([{ name: 'send_message', description: 'Send a message' }]);

      const out = (await mcpConnectorToolExtension.schemas()) as {
        function: { name: string; description: string; parameters: unknown };
      }[];

      expect(fetchTools).toHaveBeenCalledTimes(1); // disabled connector skipped
      expect(out).toHaveLength(1);
      expect(out[0]!.function.name).toBe('mcp__7__send_message');
      expect(out[0]!.function.description).toBe('[Slack] Send a message');
    });

    it('falls back to an empty object schema when a tool has no inputSchema', async () => {
      listConnectors.mockReturnValue([{ id: 1, name: 'C', enabled: true }]);
      fetchTools.mockResolvedValue([{ name: 'get_x' }]);

      const out = (await mcpConnectorToolExtension.schemas()) as {
        function: { description: string; parameters: unknown };
      }[];

      expect(out[0]!.function.description).toBe('[C] get_x'); // falls back to tool name
      expect(out[0]!.function.parameters).toEqual({ type: 'object', properties: {} });
    });

    it('skips a connector whose fetchTools rejects but still returns others', async () => {
      listConnectors.mockReturnValue([
        { id: 1, name: 'Bad', enabled: true },
        { id: 2, name: 'Good', enabled: true },
      ]);
      fetchTools.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce([{ name: 'read_it' }]);

      const out = (await mcpConnectorToolExtension.schemas()) as { function: { name: string } }[];

      expect(out).toHaveLength(1);
      expect(out[0]!.function.name).toBe('mcp__2__read_it');
    });
  });

  describe('execute', () => {
    it('returns an error for a tool name it never registered', async () => {
      const r = await mcpConnectorToolExtension.execute('mcp__1__unknown', {});
      expect(r).toBe('Error: unknown connector tool mcp__1__unknown');
    });

    it('routes a write tool through the approval hook and does NOT call the connector when queued', async () => {
      listConnectors.mockReturnValue([{ id: 5, name: 'Slack', enabled: true }]);
      fetchTools.mockResolvedValue([{ name: 'send_message' }]);
      await mcpConnectorToolExtension.schemas();
      callHook.mockReturnValue(true);

      const r = await mcpConnectorToolExtension.execute('mcp__5__send_message', { text: 'hi' });

      expect(callHook).toHaveBeenCalledWith('mcp:proposeApproval', expect.objectContaining({ tool: 'send_message', connector: 'Slack' }));
      expect(callConnectorTool).not.toHaveBeenCalled();
      expect(r).toContain('Queued for the user');
    });

    it('runs a read tool directly without any approval hook', async () => {
      listConnectors.mockReturnValue([{ id: 5, name: 'Slack', enabled: true }]);
      fetchTools.mockResolvedValue([{ name: 'list_channels' }]);
      await mcpConnectorToolExtension.schemas();
      callConnectorTool.mockResolvedValue({ ok: true, result: 'general, random' });

      const r = await mcpConnectorToolExtension.execute('mcp__5__list_channels', {});

      expect(callHook).not.toHaveBeenCalled();
      expect(r).toBe('general, random');
    });

    it('JSON-stringifies a non-string connector result', async () => {
      listConnectors.mockReturnValue([{ id: 5, name: 'C', enabled: true }]);
      fetchTools.mockResolvedValue([{ name: 'get_thing' }]);
      await mcpConnectorToolExtension.schemas();
      callConnectorTool.mockResolvedValue({ ok: true, result: { a: 1 } });

      const r = await mcpConnectorToolExtension.execute('mcp__5__get_thing', {});
      expect(r).toBe('{"a":1}');
    });

    it('truncates output longer than 8000 chars and marks it, but leaves short output intact', async () => {
      listConnectors.mockReturnValue([{ id: 5, name: 'C', enabled: true }]);
      fetchTools.mockResolvedValue([{ name: 'get_big' }, { name: 'get_small' }]);
      await mcpConnectorToolExtension.schemas();

      callConnectorTool.mockResolvedValueOnce({ ok: true, result: 'x'.repeat(9000) });
      const big = await mcpConnectorToolExtension.execute('mcp__5__get_big', {});
      expect(big).toHaveLength(8000 + '… (truncated)'.length);
      expect(big.endsWith('… (truncated)')).toBe(true);
      expect(big.startsWith('x'.repeat(8000))).toBe(true);

      callConnectorTool.mockResolvedValueOnce({ ok: true, result: 'y'.repeat(8000) });
      const small = await mcpConnectorToolExtension.execute('mcp__5__get_small', {});
      expect(small).toBe('y'.repeat(8000)); // exactly 8000 is not truncated
    });

    it('surfaces a failed connector call as an Error string', async () => {
      listConnectors.mockReturnValue([{ id: 5, name: 'C', enabled: true }]);
      fetchTools.mockResolvedValue([{ name: 'get_thing' }]);
      await mcpConnectorToolExtension.schemas();
      callConnectorTool.mockResolvedValue({ ok: false, error: 'boom' });

      const r = await mcpConnectorToolExtension.execute('mcp__5__get_thing', {});
      expect(r).toBe('Error: boom');
    });

    it('catches a thrown connector error and returns its message', async () => {
      listConnectors.mockReturnValue([{ id: 5, name: 'C', enabled: true }]);
      fetchTools.mockResolvedValue([{ name: 'get_thing' }]);
      await mcpConnectorToolExtension.schemas();
      callConnectorTool.mockRejectedValue(new Error('network down'));

      const r = await mcpConnectorToolExtension.execute('mcp__5__get_thing', {});
      expect(r).toBe('Error: network down');
    });
  });
});
