import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  MagnifyingGlass,
  Trash,
  Copy,
  Check,
  Image as ImageIcon,
  FileText,
  File as FileIcon,
  ClipboardText,
  Gear,
} from '@phosphor-icons/react';
import { clip, timeAgo, typeLabel, type ClipItem, type ContentType } from './clipboard/clipboardUtil';

interface ClipSettings { captureEnabled: boolean; maxItems: number; retentionDays: number; captureImages: boolean }

// Self-contained clipboard settings panel: capture on/off, item cap, retention,
// and whether to keep images. Persists via the clipboard IPC (applied immediately).
function ClipboardSettingsPanel({ onClose }: { onClose: () => void }): React.JSX.Element {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const api = (window as any).api?.clipboard;
  const [s, setS] = useState<ClipSettings | null>(null);
  useEffect(() => { api?.getSettings?.().then(setS).catch(() => {}); }, [api]);
  const set = (patch: Partial<ClipSettings>): void => {
    setS((prev) => (prev ? { ...prev, ...patch } : prev));
    api?.setSettings?.(patch);
  };
  if (!s) return <div className="p-6 text-sm text-neutral-600">Loading…</div>;
  const RETENTION = [{ label: 'Forever', days: 0 }, { label: '7 days', days: 7 }, { label: '30 days', days: 30 }, { label: '90 days', days: 90 }];
  const CAPS = [100, 500, 1000, 5000];
  const Toggle = ({ on, onClick }: { on: boolean; onClick: () => void }): React.JSX.Element => (
    <button onClick={onClick} aria-pressed={on} className={`h-6 w-11 rounded-full border transition-colors ${on ? 'border-green-500 bg-green-500/20' : 'border-neutral-700 bg-neutral-900'}`}>
      <span className={`block h-4 w-4 rounded-full bg-neutral-300 transition-transform ${on ? 'translate-x-5' : 'translate-x-1'}`} />
    </button>
  );
  return (
    <div className="flex h-full flex-col bg-neutral-950 font-mono text-neutral-200">
      <div className="flex items-center justify-between border-b border-neutral-800 px-5 py-3">
        <h1 className="text-sm font-semibold tracking-wide text-white">Clipboard settings</h1>
        <button onClick={onClose} className="rounded-md border border-neutral-700 px-2.5 py-1 text-xs text-neutral-300 transition-colors hover:text-white">Done</button>
      </div>
      <div className="flex-1 space-y-6 overflow-y-auto p-5">
        <div className="flex items-center justify-between">
          <div><div className="text-sm text-white">Capture clipboard</div><div className="text-[11px] text-neutral-500">Save what you copy to local history.</div></div>
          <Toggle on={s.captureEnabled} onClick={() => set({ captureEnabled: !s.captureEnabled })} />
        </div>
        <div className="flex items-center justify-between">
          <div><div className="text-sm text-white">Capture images</div><div className="text-[11px] text-neutral-500">Keep copied images (uses more disk).</div></div>
          <Toggle on={s.captureImages} onClick={() => set({ captureImages: !s.captureImages })} />
        </div>
        <div>
          <div className="mb-2 text-sm text-white">Keep history for</div>
          <div className="flex flex-wrap gap-1.5">
            {RETENTION.map((r) => (
              <button key={r.days} onClick={() => set({ retentionDays: r.days })} className={`rounded-full border px-2.5 py-1 text-[11px] transition-colors ${s.retentionDays === r.days ? 'border-green-500 text-green-500' : 'border-neutral-800 text-neutral-400 hover:border-neutral-700'}`}>{r.label}</button>
            ))}
          </div>
        </div>
        <div>
          <div className="mb-2 text-sm text-white">Maximum items <span className="text-neutral-500">({s.maxItems})</span></div>
          <div className="flex flex-wrap gap-1.5">
            {CAPS.map((c) => (
              <button key={c} onClick={() => set({ maxItems: c })} className={`rounded-full border px-2.5 py-1 text-[11px] transition-colors ${s.maxItems === c ? 'border-green-500 text-green-500' : 'border-neutral-800 text-neutral-400 hover:border-neutral-700'}`}>{c.toLocaleString()}</button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function TypeIcon({ type, className }: { type: ContentType; className?: string }): React.JSX.Element {
  if (type === 'image') return <ImageIcon className={className} />;
  if (type === 'file') return <FileIcon className={className} />;
  if (type === 'rtf') return <FileText className={className} />;
  return <ClipboardText className={className} />;
}

export function ClipboardScreen(): React.JSX.Element {
  const [items, setItems] = useState<ClipItem[]>([]);
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [showSettings, setShowSettings] = useState(false);

  const load = useCallback(async () => {
    const api = clip();
    if (!api) return;
    const q = query.trim();
    if (q) {
      const results = await api.search(q);
      setItems(results.map((r) => r.item));
    } else {
      setItems(await api.list(300));
    }
  }, [query]);

  // Initial load + refresh whenever the history changes (new copy, delete, clear).
  useEffect(() => {
    void load();
    const off = clip()?.onChanged(() => void load());
    return off;
  }, [load]);

  // Keep a valid selection as the list changes.
  useEffect(() => {
    if (items.length === 0) {
      setSelectedId(null);
      return;
    }
    if (!selectedId || !items.some((i) => i.id === selectedId)) {
      setSelectedId(items[0].id);
    }
  }, [items, selectedId]);

  const selected = useMemo(() => items.find((i) => i.id === selectedId) ?? null, [items, selectedId]);

  // Load the full image when an image item is selected.
  useEffect(() => {
    let cancelled = false;
    setImagePreview(null);
    if (selected?.contentType === 'image') {
      void clip()
        ?.getImage(selected.id)
        .then((url) => {
          if (!cancelled) setImagePreview(url);
        });
    }
    return () => {
      cancelled = true;
    };
  }, [selected]);

  const restore = useCallback(async (id: string) => {
    await clip()?.restore(id);
    setCopiedId(id);
    setTimeout(() => setCopiedId((c) => (c === id ? null : c)), 1200);
  }, []);

  const remove = useCallback(async (id: string) => {
    await clip()?.remove(id);
  }, []);

  const clearAll = useCallback(async () => {
    if (items.length === 0) return;
    await clip()?.clear();
  }, [items.length]);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (items.length === 0) return;
      const idx = items.findIndex((i) => i.id === selectedId);
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedId(items[Math.min(items.length - 1, idx + 1)].id);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedId(items[Math.max(0, idx - 1)].id);
      } else if (e.key === 'Enter' && selectedId) {
        e.preventDefault();
        void restore(selectedId);
      } else if ((e.key === 'Backspace' || e.key === 'Delete') && (e.metaKey || e.ctrlKey) && selectedId) {
        e.preventDefault();
        void remove(selectedId);
      }
    },
    [items, selectedId, restore, remove]
  );

  // Keep the selected row in view during keyboard nav.
  useEffect(() => {
    if (!selectedId || !listRef.current) return;
    const el = listRef.current.querySelector(`[data-id="${selectedId}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [selectedId]);

  if (showSettings) return <ClipboardSettingsPanel onClose={() => setShowSettings(false)} />;

  return (
    <div className="flex h-full flex-col bg-neutral-950 text-neutral-200" onKeyDown={onKeyDown} tabIndex={-1}>
      {/* Header */}
      <div className="flex items-center justify-between border-b border-neutral-800 px-5 py-3">
        <div className="flex items-center gap-2">
          <ClipboardText className="h-4 w-4 text-emerald-400" weight="bold" />
          <h1 className="text-sm font-semibold tracking-wide text-white">Clipboard</h1>
          <span className="text-xs text-neutral-500">{items.length} items</span>
          <span className="ml-2 flex items-center gap-1 text-[11px] text-neutral-500">
            <span>Quick open anywhere</span>
            <kbd className="rounded border border-neutral-700 bg-neutral-900 px-1.5 py-0.5 font-mono text-[10px] text-neutral-300">⌘⇧C</kbd>
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowSettings(true)}
            aria-label="Clipboard settings"
            className="flex items-center gap-1.5 rounded border border-neutral-800 px-2.5 py-1 text-xs text-neutral-400 transition-colors hover:border-neutral-700 hover:text-neutral-200"
          >
            <Gear className="h-3.5 w-3.5" /> Settings
          </button>
          <button
            onClick={clearAll}
            disabled={items.length === 0}
            className="flex items-center gap-1.5 rounded border border-neutral-800 px-2.5 py-1 text-xs text-neutral-400 transition-colors hover:border-neutral-700 hover:text-neutral-200 disabled:opacity-40"
          >
            <Trash className="h-3.5 w-3.5" /> Clear all
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="border-b border-neutral-900 px-5 py-2.5">
        <div className="flex items-center gap-2 rounded border border-neutral-800 bg-neutral-900 px-2.5 py-1.5 focus-within:border-emerald-500/60">
          <MagnifyingGlass className="h-4 w-4 text-neutral-500" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search clipboard history…"
            className="w-full bg-transparent text-sm text-neutral-100 placeholder:text-neutral-600 focus:outline-none"
          />
        </div>
      </div>

      {/* Two-pane: list + preview */}
      <div className="flex min-h-0 flex-1">
        <div ref={listRef} className="w-1/2 min-w-[320px] overflow-y-auto border-r border-neutral-900">
          {items.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-neutral-600">
              <ClipboardText className="h-8 w-8" />
              <p className="text-sm">{query ? 'No matches.' : 'Nothing copied yet.'}</p>
              {!query && <p className="text-xs">Copy anything — it shows up here. Press ⌘⇧C anywhere for quick paste.</p>}
            </div>
          ) : (
            items.map((it) => (
              <button
                key={it.id}
                data-id={it.id}
                onClick={() => setSelectedId(it.id)}
                onDoubleClick={() => void restore(it.id)}
                className={`flex w-full items-start gap-3 border-b border-neutral-900 px-4 py-2.5 text-left transition-colors ${
                  it.id === selectedId ? 'bg-neutral-900' : 'hover:bg-neutral-900/50'
                }`}
              >
                <TypeIcon
                  type={it.contentType}
                  className={`mt-0.5 h-4 w-4 shrink-0 ${it.id === selectedId ? 'text-emerald-400' : 'text-neutral-500'}`}
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm text-neutral-200">{it.preview || typeLabel(it.contentType)}</div>
                  <div className="mt-0.5 flex items-center gap-2 text-[11px] text-neutral-600">
                    <span>{typeLabel(it.contentType)}</span>
                    {it.sourceApp && <span className="truncate">· {it.sourceApp}</span>}
                    <span>· {timeAgo(it.timestamp)}</span>
                  </div>
                </div>
                {copiedId === it.id && <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" weight="bold" />}
              </button>
            ))
          )}
        </div>

        {/* Preview */}
        <div className="flex w-1/2 flex-col">
          {selected ? (
            <>
              <div className="flex items-center justify-between border-b border-neutral-900 px-5 py-2.5">
                <div className="flex items-center gap-2 text-xs text-neutral-500">
                  <TypeIcon type={selected.contentType} className="h-3.5 w-3.5" />
                  <span>{typeLabel(selected.contentType)}</span>
                  <span>· {timeAgo(selected.timestamp)}</span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => void restore(selected.id)}
                    className="flex items-center gap-1.5 rounded bg-emerald-500/15 px-2.5 py-1 text-xs text-emerald-400 transition-colors hover:bg-emerald-500/25"
                  >
                    {copiedId === selected.id ? <Check className="h-3.5 w-3.5" weight="bold" /> : <Copy className="h-3.5 w-3.5" />}
                    {copiedId === selected.id ? 'Copied' : 'Copy'}
                  </button>
                  <button
                    onClick={() => void remove(selected.id)}
                    className="flex items-center gap-1.5 rounded border border-neutral-800 px-2.5 py-1 text-xs text-neutral-400 transition-colors hover:border-red-500/40 hover:text-red-400"
                  >
                    <Trash className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
              <div className="min-h-0 flex-1 overflow-auto p-5">
                {selected.contentType === 'image' ? (
                  imagePreview ? (
                    <img src={imagePreview} alt="clipboard" className="max-h-full max-w-full rounded border border-neutral-800 object-contain" />
                  ) : (
                    <div className="text-sm text-neutral-600">Loading image…</div>
                  )
                ) : (
                  <pre className="whitespace-pre-wrap break-words font-mono text-sm leading-relaxed text-neutral-300">
                    {selected.textContent || selected.preview}
                  </pre>
                )}
              </div>
            </>
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-neutral-600">Select an item to preview</div>
          )}
        </div>
      </div>
    </div>
  );
}
