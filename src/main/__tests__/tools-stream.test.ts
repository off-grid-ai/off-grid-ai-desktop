import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// C7 - the streaming agentic tool loop. We fake the two TRUE boundaries: the model
// (llm.streamChat, a network/native call) and the settings DB. Everything else - the
// loop control flow (stream deltas, accumulate tool_calls, execute, feed results back,
// loop, then return the final answer) - runs for real. That control flow is the behavior
// under test, so it must fail if the loop regresses.
const { streamChatMock, initMock } = vi.hoisted(() => ({
  streamChatMock: vi.fn(),
  initMock: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../llm', () => ({ llm: { init: initMock, streamChat: streamChatMock } }));
const { getSettingMock, saveSettingMock } = vi.hoisted(() => ({ getSettingMock: vi.fn(() => [] as string[]), saveSettingMock: vi.fn() }));
vi.mock('../database', () => ({ getSetting: getSettingMock, saveSetting: saveSettingMock }));

import { toolChat, listTools, setToolEnabled, registerToolExtension, getToolExtensions, readUrlText } from '../tools';

// A tiny fake tool call helper: script one tool round then a final answer.
function scriptToolThenAnswer(name: string, args: string, answer: string): void {
  streamChatMock.mockImplementationOnce(async () => ({ content: '', toolCalls: [{ id: 'c', name, arguments: args }] }));
  streamChatMock.mockImplementationOnce(async () => ({ content: answer, toolCalls: [] }));
}

describe('toolChat streaming loop (C7)', () => {
  beforeEach(() => { streamChatMock.mockReset(); });

  it('streams reasoning + content and returns the answer when no tool is called', async () => {
    streamChatMock.mockImplementationOnce(async (_messages: unknown, onDelta: (t: string, k: string) => void) => {
      onDelta('Let me think', 'reasoning');
      onDelta('Hi there', 'content');
      return { content: 'Hi there', toolCalls: [] };
    });
    const deltas: { text: string; kind: string }[] = [];
    const steps: string[] = [];
    const r = await toolChat('hi', [], { onDelta: (t, k) => deltas.push({ text: t, kind: k }), onStep: (c) => steps.push(c.name) });

    expect(r.answer).toBe('Hi there');
    expect(deltas).toContainEqual({ text: 'Let me think', kind: 'reasoning' });
    expect(deltas).toContainEqual({ text: 'Hi there', kind: 'content' });
    expect(steps).toEqual([]); // no tool call -> no step
    expect(streamChatMock).toHaveBeenCalledTimes(1);
  });

  it('executes a tool call, fires onStep before running it, feeds the result back, then streams the final answer', async () => {
    // Round 1: the model calls a pure built-in tool (get_datetime - no network/DB).
    streamChatMock.mockImplementationOnce(async () => ({
      content: '', toolCalls: [{ id: 'c1', name: 'get_datetime', arguments: '{}' }],
    }));
    // Round 2: with the tool result in context, the model answers (streamed).
    streamChatMock.mockImplementationOnce(async (_m: unknown, onDelta: (t: string, k: string) => void) => {
      onDelta('It is now.', 'content');
      return { content: 'It is now.', toolCalls: [] };
    });

    const steps: string[] = [];
    const r = await toolChat('what time is it', [], { onStep: (c) => steps.push(c.name) });

    expect(steps).toEqual(['get_datetime']);                 // step surfaced BEFORE execution
    expect(r.toolCalls.map((c) => c.name)).toEqual(['get_datetime']);
    expect(r.toolCalls[0].result).toBeTruthy();              // real get_datetime output
    expect(r.answer).toBe('It is now.');
    expect(streamChatMock).toHaveBeenCalledTimes(2);

    // The second model call must include the assistant tool_call turn + the tool result,
    // so the model can use it (the loop fed the result back).
    const round2Messages = streamChatMock.mock.calls[1][0] as { role: string }[];
    expect(round2Messages.some((m) => m.role === 'tool')).toBe(true);
    expect(round2Messages.some((m) => m.role === 'assistant')).toBe(true);
  });

  it('passes the tool schemas + tool_choice to the model on the first round', async () => {
    streamChatMock.mockImplementationOnce(async () => ({ content: 'ok', toolCalls: [] }));
    await toolChat('hi', []);
    const opts = streamChatMock.mock.calls[0][2] as { tools?: unknown[]; toolChoice?: string };
    expect(Array.isArray(opts.tools)).toBe(true);
    expect((opts.tools as unknown[]).length).toBeGreaterThan(0);
    expect(opts.toolChoice).toBe('auto');
  });

  it('stops after the max tool-step budget instead of looping forever', async () => {
    // Model always calls a tool - the loop must bail, not spin.
    streamChatMock.mockImplementation(async () => ({
      content: '', toolCalls: [{ id: 'x', name: 'get_datetime', arguments: '{}' }],
    }));
    const r = await toolChat('loop', []);
    expect(r.answer).toMatch(/too many tool steps/i);
    expect(streamChatMock.mock.calls.length).toBeLessThanOrEqual(5);
  });

  it('runs the calculator tool and returns its numeric result', async () => {
    scriptToolThenAnswer('calculator', '{"expression":"(3+4)*2"}', 'The answer is 14.');
    const r = await toolChat('math', []);
    expect(r.toolCalls[0]).toMatchObject({ name: 'calculator', result: '14' });
    expect(r.answer).toBe('The answer is 14.');
  });

  it('rejects a non-arithmetic calculator expression (guard branch)', async () => {
    scriptToolThenAnswer('calculator', '{"expression":"process.exit(1)"}', 'Cannot compute that.');
    const r = await toolChat('evil', []);
    expect(r.toolCalls[0].result).toMatch(/only basic arithmetic/i);
  });

  it('tolerates malformed tool arguments (empty args object)', async () => {
    scriptToolThenAnswer('get_datetime', 'not-json', 'done');
    const r = await toolChat('time', []);
    expect(r.toolCalls[0].name).toBe('get_datetime');
    expect(r.answer).toBe('done');
  });

  it('offers the generate_image schema only when an image model is available', async () => {
    // imageAvailable: true -> the tool is offered.
    streamChatMock.mockImplementationOnce(async () => ({ content: 'ok', toolCalls: [] }));
    await toolChat('draw a cat', [], { imageAvailable: true });
    const withImg = streamChatMock.mock.calls[0][2] as { tools: { function: { name: string } }[] };
    expect(withImg.tools.map((t) => t.function.name)).toContain('generate_image');

    // imageAvailable: false -> it is withheld (intent may misclassify, but no model to run).
    streamChatMock.mockReset();
    streamChatMock.mockImplementationOnce(async () => ({ content: 'ok', toolCalls: [] }));
    await toolChat('draw a cat', [], { imageAvailable: false });
    const withoutImg = streamChatMock.mock.calls[0][2] as { tools: { function: { name: string } }[] };
    expect(withoutImg.tools.map((t) => t.function.name)).not.toContain('generate_image');
  });

  it('records the requested prompt as imageRequest, fires onStep, and still returns the final answer', async () => {
    // Round 1: the model calls generate_image. Round 2: it wraps up with a text answer,
    // which proves the placeholder tool result was fed back into context.
    scriptToolThenAnswer('generate_image', '{"prompt":"a red bicycle on a beach"}', 'Here is your image.');
    const steps: string[] = [];
    const r = await toolChat('make a picture of a red bicycle', [], { imageAvailable: true, onStep: (c) => steps.push(c.name) });

    expect(steps).toEqual(['generate_image']);                             // activity surfaced
    expect(r.imageRequest).toEqual({ prompt: 'a red bicycle on a beach' }); // prompt captured
    expect(r.toolCalls[0].name).toBe('generate_image');
    expect(r.toolCalls[0].result).toMatch(/will appear in the chat/i);     // placeholder fed back
    expect(r.answer).toBe('Here is your image.');                          // loop still finished
    expect(streamChatMock).toHaveBeenCalledTimes(2);

    // The second model round must include the tool result so the model could wrap up.
    const round2 = streamChatMock.mock.calls[1][0] as { role: string }[];
    expect(round2.some((m) => m.role === 'tool')).toBe(true);
  });

  it('last generate_image call wins when the model requests more than one', async () => {
    streamChatMock.mockImplementationOnce(async () => ({
      content: '', toolCalls: [
        { id: 'c1', name: 'generate_image', arguments: '{"prompt":"first"}' },
        { id: 'c2', name: 'generate_image', arguments: '{"prompt":"second"}' },
      ],
    }));
    streamChatMock.mockImplementationOnce(async () => ({ content: 'done', toolCalls: [] }));
    const r = await toolChat('two pictures', [], { imageAvailable: true });
    expect(r.imageRequest).toEqual({ prompt: 'second' });
  });

  it('does not record an imageRequest when the prompt is empty', async () => {
    scriptToolThenAnswer('generate_image', '{"prompt":"   "}', 'I could not tell what to draw.');
    const r = await toolChat('draw', [], { imageAvailable: true });
    expect(r.imageRequest).toBeUndefined();
    expect(r.toolCalls[0].result).toMatch(/no image prompt/i);
  });

  it('routes a connector/extension tool through the registered extension (connectors on)', async () => {
    const execute = vi.fn(async () => 'ext-result');
    registerToolExtension({
      id: 'test-ext',
      schemas: () => [{ type: 'function', function: { name: 'ext_tool', description: 'x', parameters: { type: 'object', properties: {} } } }],
      canHandle: (n) => n === 'ext_tool',
      execute,
      systemHint: () => 'Extra hint.',
    });
    expect(getToolExtensions().some((e) => e.id === 'test-ext')).toBe(true);

    scriptToolThenAnswer('ext_tool', '{}', 'used the connector');
    const r = await toolChat('do it', [], { connectors: true });
    expect(execute).toHaveBeenCalledWith('ext_tool', {});
    expect(r.toolCalls[0]).toMatchObject({ name: 'ext_tool', result: 'ext-result' });
  });
});

describe('tools registry surface', () => {
  it('listTools reports every built-in with an enabled flag', () => {
    getSettingMock.mockReturnValueOnce([]); // nothing disabled
    const list = listTools();
    expect(list.length).toBeGreaterThan(0);
    expect(list.map((t) => t.name)).toContain('calculator');
    expect(list.every((t) => t.enabled)).toBe(true);
  });

  it('listTools marks a disabled tool', () => {
    getSettingMock.mockReturnValueOnce(['calculator']);
    const calc = listTools().find((t) => t.name === 'calculator');
    expect(calc?.enabled).toBe(false);
  });

  it('setToolEnabled persists the disabled-set change', () => {
    getSettingMock.mockReturnValueOnce([]);
    setToolEnabled('calculator', false);
    expect(saveSettingMock).toHaveBeenCalledWith('disabledTools', ['calculator']);
    getSettingMock.mockReturnValueOnce(['calculator']);
    setToolEnabled('calculator', true);
    expect(saveSettingMock).toHaveBeenCalledWith('disabledTools', []);
  });
});

describe('web tool HTML parsing (fetch faked at the network boundary)', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('readUrlText strips tags + decodes entities into readable text', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      text: async () => '<html><body><script>x()</script><h1>Title &amp; more</h1><p>Hello&nbsp;world</p></body></html>',
    })));
    const text = await readUrlText('example.com'); // no scheme -> https:// prepended
    expect(text).toContain('Title & more');
    expect(text).toContain('Hello world');
    expect(text).not.toContain('<h1>');
    expect(text).not.toContain('x()'); // script stripped
  });

  it('readUrlText throws on a non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500, text: async () => '' })));
    await expect(readUrlText('https://example.com')).rejects.toThrow(/HTTP 500/);
  });

  it('web_search parses DuckDuckGo result links + snippets', async () => {
    const html = `
      <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fen.wikipedia.org%2FAchilles">Achilles - Wikipedia</a>
      <a class="result__snippet">A hero of the Trojan War.</a>`;
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, text: async () => html })));
    scriptToolThenAnswer('web_search', '{"query":"achilles"}', 'Here is what I found.');
    const r = await toolChat('search achilles', []);
    // web_search decodes the DDG redirect + strips tags in the title/snippet.
    expect(r.toolCalls[0].result).toContain('en.wikipedia.org/Achilles');
    expect(r.toolCalls[0].result).toContain('Achilles - Wikipedia');
    expect(r.toolCalls[0].result).toContain('Trojan War');
  });
});
