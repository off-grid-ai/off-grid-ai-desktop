type ContentType = 'text' | 'rtf' | 'image' | 'file';
/** A captured clipboard entry, including its raw bytes. */
interface ClipboardItem {
    id: string;
    timestamp: number;
    contentType: ContentType;
    textContent: string | null;
    rawData: Uint8Array;
    /** App the content was copied from, when the platform can report it. */
    sourceApp: string | null;
    /** sha256 of rawData, used for dedup and as the sync key. */
    hash: string;
}
/** A clipboard entry without the heavy raw bytes, for lists/UI. */
interface ClipboardItemDisplay {
    id: string;
    timestamp: number;
    contentType: ContentType;
    textContent: string | null;
    sourceApp: string | null;
    preview: string;
}
interface SearchResult {
    item: ClipboardItemDisplay;
    score: number;
    matches: Array<[number, number]>;
}
/** What a platform bridge reads from the OS clipboard at a point in time. */
interface ClipboardRead {
    contentType: ContentType;
    rawData: Uint8Array;
    textContent: string | null;
    sourceApp?: string | null;
}
/**
 * Platform bridge: how the engine reads from and writes to the OS clipboard.
 * Electron (desktop) and React Native (mobile) each provide an implementation,
 * so the engine itself stays free of platform imports.
 */
interface ClipboardBridge {
    /** Read the current clipboard contents, or null if empty/unsupported. */
    read(): ClipboardRead | null;
    /** Put an item back on the OS clipboard (used when the user picks one). */
    write(item: ClipboardItem): void;
}
/**
 * Persistence for clipboard history. A local SQLite store today; an
 * @offgrid/memory op-log adapter later so clipboard syncs across devices.
 */
interface ClipboardStore {
    /** Insert a new item. Returns null if a row with the same hash exists
     * (the store should bump that row's timestamp instead). */
    insert(item: Omit<ClipboardItem, 'id'>): ClipboardItem | null;
    list(limit?: number): ClipboardItemDisplay[];
    get(id: string): ClipboardItem | null;
    remove(id: string): void;
    clear(): void;
    count(): number;
}

export type { ClipboardBridge as C, SearchResult as S, ClipboardRead as a, ClipboardItem as b, ClipboardStore as c, ClipboardItemDisplay as d, ContentType as e };
