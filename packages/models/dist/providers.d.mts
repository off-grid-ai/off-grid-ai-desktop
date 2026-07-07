export type ChatRole = 'system' | 'user' | 'assistant';
export interface ChatMessage {
    role: ChatRole;
    content: string;
}
export interface ChatOptions {
    model?: string;
    temperature?: number;
    maxTokens?: number;
    signal?: AbortSignal;
}
export interface ProviderModel {
    id: string;
    name: string;
}
/** Local or remote LLM. chat() streams text chunks. */
export interface InferenceProvider {
    readonly id: string;
    readonly name: string;
    listModels(): Promise<ProviderModel[]>;
    chat(messages: ChatMessage[], opts?: ChatOptions): AsyncIterable<string>;
}
export type RemoteServerKind = 'openai' | 'ollama';
export interface RemoteServerConfig {
    id: string;
    name: string;
    kind: RemoteServerKind;
    /** Base URL. OpenAI-compatible includes the /v1 suffix; Ollama is the host root. */
    endpoint: string;
    apiKey?: string;
}
interface FetchResponse {
    ok: boolean;
    status: number;
    json(): Promise<unknown>;
    body: ReadableStream<Uint8Array> | null;
}
export type FetchLike = (url: string, init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
}) => Promise<FetchResponse>;
/** OpenAI-compatible provider: local llama-server, LM Studio, LocalAI, OpenAI. */
export declare function openAICompatibleProvider(cfg: {
    id: string;
    name: string;
    endpoint: string;
    apiKey?: string;
    fetchImpl?: FetchLike;
}): InferenceProvider;
/** Ollama provider (/api/tags, /api/chat NDJSON). */
export declare function ollamaProvider(cfg: {
    id: string;
    name: string;
    endpoint: string;
    fetchImpl?: FetchLike;
}): InferenceProvider;
/** Build a provider from a remote server config. */
export declare function createProvider(server: RemoteServerConfig, fetchImpl?: FetchLike): InferenceProvider;
/** Registry of available providers (local + remote) with an active selection. */
export declare class ProviderRegistry {
    private providers;
    private activeId;
    register(provider: InferenceProvider): void;
    unregister(id: string): void;
    list(): InferenceProvider[];
    setActive(id: string): void;
    active(): InferenceProvider | null;
}
export {};
