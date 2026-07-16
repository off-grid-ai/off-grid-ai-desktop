// Inference provider abstraction: one interface for local AND remote LLM
// execution. In-package HTTP clients cover OpenAI-compatible servers (the
// desktop's local llama-server on 127.0.0.1, plus LM Studio / LocalAI / OpenAI)
// and Ollama. Mobile's in-process runtime (llama.rn) implements the same
// InferenceProvider interface directly. All shared; platforms inject nothing
// beyond an endpoint (or, for in-process, their own provider).

export type ChatRole = 'system' | 'user' | 'assistant'
export interface ChatMessage {
  role: ChatRole
  content: string
}
export interface ChatOptions {
  model?: string
  temperature?: number
  maxTokens?: number
  signal?: AbortSignal
}
export interface ProviderModel {
  id: string
  name: string
}

/** Local or remote LLM. chat() streams text chunks. */
export interface InferenceProvider {
  readonly id: string
  readonly name: string
  listModels(): Promise<ProviderModel[]>
  chat(messages: ChatMessage[], opts?: ChatOptions): AsyncIterable<string>
}

export type RemoteServerKind = 'openai' | 'ollama'
export interface RemoteServerConfig {
  id: string
  name: string
  kind: RemoteServerKind
  /** Base URL. OpenAI-compatible includes the /v1 suffix; Ollama is the host root. */
  endpoint: string
  apiKey?: string
}

interface FetchResponse {
  ok: boolean
  status: number
  json(): Promise<unknown>
  body: ReadableStream<Uint8Array> | null
}
export type FetchLike = (
  url: string,
  init?: {
    method?: string
    headers?: Record<string, string>
    body?: string
    signal?: AbortSignal
  }
) => Promise<FetchResponse>

const defaultFetch: FetchLike = (url, init) => fetch(url, init) as unknown as Promise<FetchResponse>

function authHeaders(apiKey?: string): Record<string, string> {
  return apiKey ? { Authorization: `Bearer ${apiKey}` } : {}
}

async function* lines(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    const parts = buf.split('\n')
    buf = parts.pop() ?? ''
    for (const line of parts) yield line
  }
  if (buf.trim()) yield buf
}

/** OpenAI-compatible provider: local llama-server, LM Studio, LocalAI, OpenAI. */
export function openAICompatibleProvider(cfg: {
  id: string
  name: string
  endpoint: string
  apiKey?: string
  fetchImpl?: FetchLike
}): InferenceProvider {
  const f = cfg.fetchImpl ?? defaultFetch
  return {
    id: cfg.id,
    name: cfg.name,
    async listModels() {
      const res = await f(`${cfg.endpoint}/models`, {
        headers: { Accept: 'application/json', ...authHeaders(cfg.apiKey) }
      })
      if (!res.ok) throw new Error(`listModels failed: HTTP ${res.status}`)
      const data = (await res.json()) as { data?: { id: string }[] }
      return (data.data ?? []).map((m) => ({ id: m.id, name: m.id }))
    },
    async *chat(messages, opts) {
      const res = await f(`${cfg.endpoint}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders(cfg.apiKey) },
        body: JSON.stringify({
          model: opts?.model,
          messages,
          stream: true,
          temperature: opts?.temperature,
          max_tokens: opts?.maxTokens
        }),
        signal: opts?.signal
      })
      if (!res.ok || !res.body) throw new Error(`chat failed: HTTP ${res.status}`)
      for await (const line of lines(res.body)) {
        const t = line.trim()
        if (!t.startsWith('data:')) continue
        const data = t.slice(5).trim()
        if (data === '[DONE]') return
        try {
          const j = JSON.parse(data) as { choices?: { delta?: { content?: string } }[] }
          const c = j.choices?.[0]?.delta?.content
          if (c) yield c
        } catch {
          // ignore keep-alives / malformed lines
        }
      }
    }
  }
}

/** Ollama provider (/api/tags, /api/chat NDJSON). */
export function ollamaProvider(cfg: {
  id: string
  name: string
  endpoint: string
  fetchImpl?: FetchLike
}): InferenceProvider {
  const f = cfg.fetchImpl ?? defaultFetch
  return {
    id: cfg.id,
    name: cfg.name,
    async listModels() {
      const res = await f(`${cfg.endpoint}/api/tags`, { headers: { Accept: 'application/json' } })
      if (!res.ok) throw new Error(`listModels failed: HTTP ${res.status}`)
      const data = (await res.json()) as { models?: { name: string }[] }
      return (data.models ?? []).map((m) => ({ id: m.name, name: m.name }))
    },
    async *chat(messages, opts) {
      const res = await f(`${cfg.endpoint}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: opts?.model, messages, stream: true }),
        signal: opts?.signal
      })
      if (!res.ok || !res.body) throw new Error(`chat failed: HTTP ${res.status}`)
      for await (const line of lines(res.body)) {
        const t = line.trim()
        if (!t) continue
        try {
          const j = JSON.parse(t) as { message?: { content?: string }; done?: boolean }
          if (j.message?.content) yield j.message.content
          if (j.done) return
        } catch {
          // ignore
        }
      }
    }
  }
}

/** Build a provider from a remote server config. */
export function createProvider(
  server: RemoteServerConfig,
  fetchImpl?: FetchLike
): InferenceProvider {
  if (server.kind === 'ollama') {
    return ollamaProvider({
      id: server.id,
      name: server.name,
      endpoint: server.endpoint,
      fetchImpl
    })
  }
  return openAICompatibleProvider({
    id: server.id,
    name: server.name,
    endpoint: server.endpoint,
    apiKey: server.apiKey,
    fetchImpl
  })
}

/** Registry of available providers (local + remote) with an active selection. */
export class ProviderRegistry {
  private providers = new Map<string, InferenceProvider>()
  private activeId: string | null = null

  register(provider: InferenceProvider): void {
    this.providers.set(provider.id, provider)
    if (!this.activeId) this.activeId = provider.id
  }
  unregister(id: string): void {
    this.providers.delete(id)
    if (this.activeId === id) this.activeId = this.providers.keys().next().value ?? null
  }
  list(): InferenceProvider[] {
    return [...this.providers.values()]
  }
  setActive(id: string): void {
    if (this.providers.has(id)) this.activeId = id
  }
  active(): InferenceProvider | null {
    return this.activeId ? (this.providers.get(this.activeId) ?? null) : null
  }
}
