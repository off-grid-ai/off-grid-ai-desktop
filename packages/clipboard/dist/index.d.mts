import { C as ClipboardBridge, c as ClipboardStore, b as ClipboardItem, d as ClipboardItemDisplay, S as SearchResult } from './types-hjEscIvQ.mjs';
export { a as ClipboardRead, e as ContentType } from './types-hjEscIvQ.mjs';

interface ClipboardEngineOptions {
    bridge: ClipboardBridge;
    store: ClipboardStore;
    /** Content hash (sha256 hex). Injected so the package stays dependency-free
     * (host passes node crypto on desktop, a JS impl on mobile). */
    hash: (data: Uint8Array) => string;
    /** Poll interval in ms. copyclip used 500ms. */
    pollIntervalMs?: number;
    /** Schedule a repeating timer. Defaults to setInterval; injectable for tests
     * or platforms with a different timer API. */
    setInterval?: (cb: () => void, ms: number) => unknown;
    clearInterval?: (handle: unknown) => void;
}
type Listener = (item: ClipboardItem) => void;
declare class ClipboardEngine {
    private readonly opts;
    private handle;
    private lastHash;
    private listeners;
    constructor(options: ClipboardEngineOptions);
    /** Subscribe to new clipboard items. Returns an unsubscribe function. */
    onItem(listener: Listener): () => void;
    start(): void;
    stop(): void;
    /** Read the clipboard once and persist if it is new. Exposed for tests. */
    tick(): ClipboardItem | null;
    private safeRead;
}

/**
 * Fuzzy search implementation ported from Swift version.
 * Uses a scoring algorithm that rewards:
 * - Consecutive matches
 * - Matches at word boundaries
 * - Matches at the start of the string
 */
interface FuzzyMatchResult {
    score: number;
    matches: Array<[number, number]>;
}
declare function fuzzyMatch(pattern: string, text: string): FuzzyMatchResult | null;
declare function fuzzySearch(items: ClipboardItemDisplay[], query: string): SearchResult[];

export { ClipboardBridge, ClipboardEngine, type ClipboardEngineOptions, ClipboardItem, ClipboardItemDisplay, ClipboardStore, SearchResult, fuzzyMatch, fuzzySearch };
