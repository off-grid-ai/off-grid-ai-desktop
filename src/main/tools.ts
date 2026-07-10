// Agentic tool-calling loop for the Off Grid chat. Kept ISOLATED from the
// default rag:chat path (opt-in) so a tool run can never break normal chat.
//
// The local model (llama-server, OpenAI-compatible /v1/chat/completions) is given
// tool schemas; we parse its tool_calls, run them on-device, feed results back,
// and loop until it answers. Built-in tools only (no network) for now — web
// search + MCP connectors plug in here later.

import fs from 'fs';
import { llm } from './llm';
import { getSetting, saveSetting } from './database';
import { buildUserContent } from './tool-content';
import { stripTags, htmlToText, decodeDdgHref } from './tools-parsers';
import { mimeFromExt } from './model-server/data-url';

// Per-tool enable/disable, persisted as a list of disabled tool names.
function disabledSet(): Set<string> {
  try { return new Set(getSetting<string[]>('disabledTools', [])); } catch { return new Set(); }
}
export function setToolEnabled(name: string, enabled: boolean): void {
  const set = disabledSet();
  if (enabled) set.delete(name); else set.add(name);
  saveSetting('disabledTools', Array.from(set));
}

// Per-turn context a tool may need beyond its args. Injected by the loop so a tool
// owns its full behavior instead of the loop special-casing it (e.g. search_memory
// excludes the current conversation so it can't cite itself).
export interface ToolContext {
  conversationId?: string;
}

// A tool's structured result. Most tools just return text (a bare string, which the
// loop normalizes to { text }); a tool may ALSO emit side channels — `sources`
// (interactive citations, from search_memory) and `imageRequest` (the deferred
// image prompt, from generate_image) — so the loop dispatches every tool uniformly
// and no longer branches on the tool's name.
export interface ToolResult {
  text: string;
  sources?: UnifiedSource[];
  imageRequest?: { prompt: string };
}

type ToolDef = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  run: (args: Record<string, unknown>, ctx: ToolContext) => Promise<string | ToolResult> | string | ToolResult;
};

// --- HTML helpers for the web tools live in ./tools-parsers (pure, unit-tested).
// Fetch a URL and return its readable text (shared by the read_url tool and the
// deterministic "read this URL, then build" flow). Works for localhost too.
export async function readUrlText(url: string): Promise<string> {
  let u = url.trim();
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
  const res = await fetch(u, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return htmlToText(await res.text());
}

// --- Built-in tools --------------------------------------------------------
const TOOLS: ToolDef[] = [
  {
    name: 'web_search',
    description: 'Search the web via DuckDuckGo and return the top results (title, URL, snippet). Use for current events or facts not in the user\'s memory. Requires network.',
    parameters: { type: 'object', properties: { query: { type: 'string', description: 'the search query' } }, required: ['query'] },
    run: async (a) => {
      const q = String(a.query ?? '').trim();
      if (!q) return 'Error: empty query.';
      try {
        const res = await fetch('https://html.duckduckgo.com/html/?q=' + encodeURIComponent(q), { headers: { 'User-Agent': 'Mozilla/5.0' } });
        const html = await res.text();
        const titles: { title: string; url: string }[] = [];
        const re = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
        let m: RegExpExecArray | null;
        while ((m = re.exec(html)) && titles.length < 6) titles.push({ url: decodeDdgHref(m[1]), title: stripTags(m[2]) });
        const snippets: string[] = [];
        const sre = /class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
        let s: RegExpExecArray | null;
        while ((s = sre.exec(html)) && snippets.length < 6) snippets.push(stripTags(s[1]));
        if (!titles.length) return 'No results found.';
        return titles.map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${snippets[i] || ''}`).join('\n');
      } catch (e) { return 'Error: search failed — ' + (e as Error).message; }
    },
  },
  {
    name: 'brave_search',
    description: 'Search the web via Brave and return the top results (title, URL). An alternative to web_search. Requires network.',
    parameters: { type: 'object', properties: { query: { type: 'string', description: 'the search query' } }, required: ['query'] },
    run: async (a) => {
      const q = String(a.query ?? '').trim();
      if (!q) return 'Error: empty query.';
      try {
        const res = await fetch('https://search.brave.com/search?q=' + encodeURIComponent(q) + '&source=web', {
          headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36', 'Accept-Language': 'en-US,en;q=0.9' },
        });
        const html = await res.text();
        const out: { title: string; url: string }[] = [];
        const seen = new Set<string>();
        const re = /<a[^>]+href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
        let m: RegExpExecArray | null;
        while ((m = re.exec(html)) && out.length < 6) {
          const url = m[1];
          if (/brave\.com|search\.brave|\/settings|javascript:/i.test(url)) continue;
          const title = stripTags(m[2]);
          if (!title || title.length < 3 || seen.has(url)) continue;
          seen.add(url);
          out.push({ title, url });
        }
        if (!out.length) return 'No results found (Brave markup may have changed — try web_search).';
        return out.map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}`).join('\n');
      } catch (e) { return 'Error: brave search failed — ' + (e as Error).message; }
    },
  },
  {
    name: 'read_url',
    description: 'Fetch a web page and return its readable text. Use to read a specific URL (e.g. one from web_search). Requires network.',
    parameters: { type: 'object', properties: { url: { type: 'string', description: 'the page URL' } }, required: ['url'] },
    run: async (a) => {
      let url = String(a.url ?? '').trim();
      if (!url) return 'Error: empty url.';
      if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
      try {
        const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        if (!res.ok) return `Error: HTTP ${res.status}`;
        const text = htmlToText(await res.text());
        return text ? text.slice(0, 6000) : 'No readable text on the page.';
      } catch (e) { return 'Error: could not fetch — ' + (e as Error).message; }
    },
  },
  {
    name: 'calculator',
    description: 'Evaluate a basic arithmetic expression and return the numeric result.',
    parameters: { type: 'object', properties: { expression: { type: 'string', description: 'e.g. "(3+4)*2/7"' } }, required: ['expression'] },
    run: (a) => {
      const expr = String(a.expression ?? '');
      if (!/^[-+*/().\d\s]+$/.test(expr)) return 'Error: only basic arithmetic is allowed.';
      try {
        // eslint-disable-next-line no-new-func
        const v = Function(`"use strict"; return (${expr})`)();
        return String(v);
      } catch {
        return 'Error: could not evaluate expression.';
      }
    },
  },
  {
    name: 'read_screen',
    description: "Read what's recently been on the user's screen (the latest captured activity). Fully local, no network. Use to answer questions about what the user was just looking at.",
    parameters: { type: 'object', properties: { limit: { type: 'number', description: 'how many recent items (default 5)' } } },
    run: async (a) => {
      try {
        const { getDB } = await import('./database');
        const db = getDB();
        const n = Math.min(20, Math.max(1, Number(a.limit) || 5));
        const rows = db.prepare(
          `SELECT summary, surface, surface_app, ts FROM observations
           WHERE COALESCE(surface_app,'') NOT LIKE '%Off Grid%' AND COALESCE(surface_app,'') NOT LIKE '%Electron%'
           ORDER BY ts DESC LIMIT ?`
        ).all(n) as { summary: string; surface: string | null; surface_app: string | null; ts: string }[];
        if (!rows.length) return 'No recent screen activity captured.';
        return rows.map((r) => `(${r.surface || r.surface_app || 'screen'} · ${r.ts}) ${r.summary}`).join('\n');
      } catch (e) { return 'Error reading screen: ' + (e as Error).message; }
    },
  },
  {
    name: 'search_memory',
    description:
      "Search the user's ENTIRE memory — past chats, screen captures, meetings, people, notes, and connected apps (Slack, Gmail, etc.) — for anything relevant. Use this for ANY question about what was said, discussed, or decided, about a PERSON, or to recall past activity (e.g. 'what were Praveen and I talking about', 'my notes on the Q3 launch'). Prefer this over read_screen unless the user explicitly asks what's on screen RIGHT NOW. Fully local.",
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'what to look for, in natural language (e.g. a person + topic)' },
        limit: { type: 'number', description: 'max results (default 8)' },
      },
      required: ['query'],
    },
    // Owns BOTH the model's text result AND the structured hits surfaced as
    // interactive citations. Excludes the current conversation (ctx) so it can't
    // cite itself. The loop dedups the returned sources across rounds.
    run: async (a, ctx): Promise<ToolResult> => {
      try {
        const { universalSearch } = await import('./search');
        const n = Math.min(20, Math.max(1, Number(a.limit) || 8));
        const hits = await universalSearch(String(a.query ?? ''), { limit: n, semantic: true, excludeChatId: ctx.conversationId });
        const sources: UnifiedSource[] = hits.map((h) => ({
          key: h.key, kind: h.kind, refId: h.refId, title: h.title, snippet: h.snippet, surface: h.surface, ts: h.ts, imagePath: h.imagePath,
        }));
        const text = hits.length
          ? hits
              .map((h) => {
                const when = h.ts ? ' · ' + new Date(h.ts).toISOString().slice(0, 16).replace('T', ' ') : '';
                return `(${h.surface || h.kind}${when}) ${h.title ? h.title + ' — ' : ''}${h.snippet}`;
              })
              .join('\n')
          : 'Nothing found in memory for that.';
        return { text, sources };
      } catch (e) {
        return { text: 'Error searching memory: ' + (e as Error).message };
      }
    },
  },
  {
    name: 'get_datetime',
    description: 'Get the current local date and time.',
    parameters: { type: 'object', properties: {} },
    run: () => new Date().toString(),
  },
  {
    // generate_image is DEFERRED: run() never generates. It records the requested
    // prompt as `imageRequest` (the loop keeps the last one) so the renderer
    // generates AFTER the turn — generating inline would evict the LLM from unified
    // memory mid-loop and risk a nested modality-queue deadlock.
    name: 'generate_image',
    description: 'Generate an image on-device from a text prompt. Use when the user asks for a picture/photo/logo/art to be created.',
    parameters: { type: 'object', properties: { prompt: { type: 'string', description: 'a detailed description of the image to create' } }, required: ['prompt'] },
    run: (a): ToolResult => {
      const prompt = String(a.prompt ?? '').trim();
      return prompt
        ? { text: 'Image generation started - it will appear in the chat.', imageRequest: { prompt } }
        : { text: 'Error: no image prompt provided.' };
    },
  },
];

// generate_image is gated on an image model being available and is never offered
// otherwise; every other built-in obeys only the disabled-set.
function schemas(imageAvailable: boolean): unknown[] {
  const off = disabledSet();
  return TOOLS
    .filter((t) => !off.has(t.name))
    .filter((t) => t.name !== 'generate_image' || imageAvailable)
    .map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } }));
}

/** Normalize a tool's return (bare string or structured) to a ToolResult. */
function asToolResult(r: string | ToolResult): ToolResult {
  return typeof r === 'string' ? { text: r } : r;
}

/** Dispatch a tool call UNIFORMLY: a registered extension that owns the name wins,
 *  else the matching built-in. Any throw becomes an error-text result (a single
 *  tool failing never aborts the turn). No name-based special-casing — each tool
 *  owns its own text + side channels (sources / imageRequest) via its ToolResult. */
async function runTool(name: string, args: Record<string, unknown>, ctx: ToolContext, exts: ToolExtension[]): Promise<ToolResult> {
  try {
    const ext = exts.find((e) => e.canHandle(name));
    if (ext) return { text: String(await ext.execute(name, args)) };
    const tool = TOOLS.find((t) => t.name === name);
    if (!tool) return { text: `Error: unknown tool ${name}` };
    return asToolResult(await tool.run(args, ctx));
  } catch (e) {
    return { text: `Error: ${(e as Error).message}` };
  }
}

// --- Tool extensions (open-core seam) --------------------------------------
// Pro features (e.g. MCP connectors) plug extra tools into the chat loop without
// core ever importing them. A pro extension registers itself during activation;
// in the free build nothing is registered and toolChat uses only the built-ins.
// Mirrors mobile/src/services/tools/extensions.ts.
export interface ToolExtension {
  id: string;
  /** OpenAI tool schemas to add when extensions are enabled. Built once per turn;
   *  the extension may cache any per-turn state it needs for execute(). */
  schemas(): Promise<unknown[]> | unknown[];
  /** Whether this extension owns a given tool name. */
  canHandle(name: string): boolean;
  /** Execute a call this extension owns; returns a string result for the model. */
  execute(name: string, args: Record<string, unknown>): Promise<string> | string;
  /** Optional system-prompt addition when this extension contributes tools. */
  systemHint?(): string;
}

const toolExtensions: ToolExtension[] = [];
export function registerToolExtension(ext: ToolExtension): void {
  if (!toolExtensions.some((e) => e.id === ext.id)) toolExtensions.push(ext);
}
export function getToolExtensions(): ToolExtension[] {
  return toolExtensions;
}

export type ToolCall = { name: string; args: Record<string, unknown>; result: string };
// Structured sources surfaced by search_memory so the chat can render them as
// interactive citation cards (thumbnail + open-in-Replay), same as the RAG path.
export type UnifiedSource = { key: string; kind: string; refId: number; title: string; snippet: string; surface: string; ts: number; imagePath: string | null };

/**
 * Run a chat turn with tool-calling. STREAMS by default (thinking -> tool-call activity
 * -> answer) through the callbacks: `onDelta` gets reasoning/content deltas, `onStep`
 * fires as each tool is about to run so the UI can show "Running web_search...". Omit the
 * callbacks (e.g. the pro skills-engine caller) and it just buffers - the final answer is
 * always the return value either way. Returns the final answer + the calls made.
 */
export async function toolChat(
  query: string,
  history: { role: string; content: string }[] = [],
  opts: {
    connectors?: boolean;
    conversationId?: string;
    images?: string[];
    imageAvailable?: boolean;
    thinking?: boolean;
    signal?: AbortSignal;
    onDelta?: (text: string, kind: 'content' | 'reasoning') => void;
    onStep?: (call: { name: string; args: Record<string, unknown> }) => void;
  } = {},
): Promise<{ answer: string; toolCalls: ToolCall[]; unified: UnifiedSource[]; imageRequest?: { prompt: string } }> {
  await llm.init(); // respects pause; ensures the server is up
  const onDelta = opts.onDelta ?? ((): void => {});

  // Offer generate_image only when an image model is available. The renderer passes
  // this; fall back to the main-process check so a caller that omits it still gates
  // correctly (single source of truth for "can we make an image right now").
  let imageAvailable = opts.imageAvailable ?? false;
  if (opts.imageAvailable === undefined) {
    try {
      const { activeImageModel } = await import('./imagegen');
      imageAvailable = !!activeImageModel();
    } catch { /* no image runtime -> stay false */ }
  }

  // Opt-in: pull in tools from registered pro extensions (e.g. MCP connectors)
  // alongside the built-ins. Schemas are built once per turn; each extension
  // caches whatever per-turn state it needs for execute(). Free build registers
  // no extensions, so this is just the built-ins.
  const exts = opts.connectors ? getToolExtensions() : [];
  const extSchemas: unknown[] = [];
  const hints: string[] = [];
  for (const e of exts) {
    try {
      const s = await e.schemas();
      if (s && s.length) {
        extSchemas.push(...s);
        if (e.systemHint) hints.push(e.systemHint());
      }
    } catch (err) { console.error('[tools] extension schemas', e.id, err); }
  }
  const tools = extSchemas.length ? [...schemas(imageAvailable), ...extSchemas] : schemas(imageAvailable);
  const sys = 'You are Off Grid, a private on-device assistant. Use the provided tools when they help answer precisely. Keep answers concise.'
    + (hints.length ? ' ' + hints.join(' ') : '');

  // Attached images ride on the current user turn so the vision model can read
  // them even in tools/connectors mode (otherwise they were silently dropped).
  const imageDataUrls: string[] = [];
  for (const p of opts.images ?? []) {
    try {
      const base64 = fs.readFileSync(p).toString('base64');
      // Route through the shared ext->MIME map (image/png fallback) so a .webp
      // attachment is labelled image/webp, not the old png-or-jpeg guess that
      // mislabelled webp as image/jpeg (which the vision model may reject).
      const mime = mimeFromExt(p.split('.').pop() ?? '');
      imageDataUrls.push(`data:${mime};base64,${base64}`);
    } catch (e) { console.error('[tools] failed to read image', p, e); }
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const messages: any[] = [
    { role: 'system', content: sys },
    ...history.slice(-10).map((m) => ({ role: m.role, content: m.content })),
    { role: 'user', content: buildUserContent(query, imageDataUrls) },
  ];
  const toolCalls: ToolCall[] = [];
  const unified: UnifiedSource[] = [];
  const unifiedKeys = new Set<string>();
  // Deferred image generation: the loop only RECORDS the requested prompt (last call
  // wins). The renderer generates after the turn so we never evict the LLM mid-loop.
  let imageRequest: { prompt: string } | undefined;

  for (let step = 0; step < 5; step++) {
    // Stream this round: reasoning + any answer text flow through onDelta live; tool_calls
    // are accumulated and returned. A tool-calling round streams thinking (and no content);
    // the final round streams the answer. tool temperature stays 0.3 (was the blocking path).
    const { content, toolCalls: calls } = await llm.streamChat(messages, onDelta, {
      tools, toolChoice: 'auto', temperature: 0.3, maxTokens: 1024, thinking: opts.thinking, signal: opts.signal,
    });

    if (calls.length) {
      // Re-add the assistant turn (with its tool_calls) so the model sees what it invoked.
      messages.push({ role: 'assistant', content: content || null, tool_calls: calls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: c.arguments } })) });
      for (const c of calls) {
        let args: Record<string, unknown> = {};
        try { args = JSON.parse(c.arguments || '{}'); } catch { /* keep empty */ }
        opts.onStep?.({ name: c.name, args }); // surface the tool activity BEFORE running it
        // Uniform dispatch — every tool owns its own result. Merge any structured
        // side channels: sources are deduped into `unified` across rounds; the last
        // non-empty imageRequest wins (deferred generation after the turn).
        const res = await runTool(c.name, args, { conversationId: opts.conversationId }, exts);
        for (const s of res.sources ?? []) {
          if (unifiedKeys.has(s.key)) continue;
          unifiedKeys.add(s.key);
          unified.push(s);
        }
        if (res.imageRequest) imageRequest = res.imageRequest;
        toolCalls.push({ name: c.name, args, result: res.text });
        messages.push({ role: 'tool', tool_call_id: c.id, content: res.text });
      }
      continue; // let the model use the results
    }
    // No tool calls this round: `content` is the final answer (already streamed via onDelta).
    return { answer: content.trim(), toolCalls, unified, imageRequest };
  }
  return { answer: 'Stopped after too many tool steps.', toolCalls, unified, imageRequest };
}

/** Names + descriptions + enabled state of all tools (for the settings UI). */
export function listTools(): { name: string; description: string; enabled: boolean }[] {
  const off = disabledSet();
  return TOOLS.map((t) => ({ name: t.name, description: t.description, enabled: !off.has(t.name) }));
}
