import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { LockKey, X } from '@phosphor-icons/react';
import { ProgressiveBlur } from './ui/progressive-blur';
import { SetupPanel } from './setup/SetupPanel';
import { StoragePanel } from './setup/StoragePanel';
import { DataPrivacyPanel } from './setup/DataPrivacyPanel';

// A Pro section shown (disabled) in the free build: title + description + a
// "Pro · July 2026" badge, dimmed and non-interactive.
function ProPlaceholder({ title, description, delay = 0.18 }: { title: string; description: string; delay?: number }): React.ReactElement {
  return (
    <motion.div
      className="relative rounded-2xl border border-neutral-800 bg-neutral-900/40 p-6"
      initial={{ opacity: 0, filter: 'blur(10px)' }}
      animate={{ opacity: 1, filter: 'blur(0px)' }}
      transition={{ duration: 0.6, delay }}
    >
      <span className="absolute right-4 top-4 inline-flex items-center gap-1 rounded-full border border-green-500/30 bg-green-500/10 px-2 py-0.5 text-[10px] uppercase tracking-wide text-green-400">
        <LockKey weight="bold" className="h-3 w-3" /> Pro · July 2026
      </span>
      <h3 className="mb-1 pr-28 text-base font-medium text-neutral-300">{title}</h3>
      <p className="text-sm text-neutral-600">{description}</p>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Proactive delivery — let Off Grid reach out unprompted
// ---------------------------------------------------------------------------

function ProactiveSection(): React.ReactElement {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const api = (window as any).api;
  const [enabled, setEnabled] = useState(true);
  useEffect(() => {
    api.getSettings?.().then((s: Record<string, unknown>) => {
      // default ON unless explicitly disabled
      setEnabled(s?.['proactive:enabled'] !== false);
    });
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, []);
  const toggle = (): void => {
    const next = !enabled;
    setEnabled(next);
    api.saveSetting?.('proactive:enabled', next);
  };
  return (
    <motion.div
      className="rounded-2xl bg-neutral-900/60 backdrop-blur-sm border border-neutral-800 p-6"
      initial={{ opacity: 0, filter: 'blur(10px)' }}
      animate={{ opacity: 1, filter: 'blur(0px)' }}
      transition={{ duration: 0.6, delay: 0.18 }}
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-white font-medium text-base mb-1">Proactive delivery</h3>
          <p className="text-neutral-500 text-sm">
            Off Grid reaches out on its own — a morning briefing of your day and a heads-up ~20 min before each meeting with who’s in it and your open items. Delivered as native notifications, even when the window is closed.
          </p>
        </div>
        <button
          onClick={toggle}
          role="switch"
          aria-checked={enabled}
          className={`relative mt-1 inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${enabled ? 'bg-emerald-500' : 'bg-neutral-700'}`}
        >
          <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${enabled ? 'translate-x-6' : 'translate-x-1'}`} />
        </button>
      </div>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Secretary — what Off Grid has learned from your dismissals
// ---------------------------------------------------------------------------

function SecretaryPrefs(): React.ReactElement {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const api = (window as any).api;
  const [doc, setDoc] = useState('');
  const load = (): void => {
    api.secretaryPrefsGet?.().then((p: { doc?: string }) => setDoc(p?.doc ?? ''));
  };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  // The doc is distilled by the assistant (auto-refreshes ~hourly). The user's
  // only manual control is REMOVING individual lines they disagree with — there's
  // no free-form editing. Persist the trimmed doc back on each removal.
  const lines = doc.split('\n').map((l) => l.trim()).filter(Boolean);
  const removeLine = async (idx: number): Promise<void> => {
    const next = lines.filter((_, i) => i !== idx).join('\n');
    setDoc(next);
    await api.secretaryPrefsSet?.(next);
  };
  const clear = async (): Promise<void> => { setDoc(''); await api.secretaryPrefsSet?.(''); };

  return (
    <motion.div
      className="rounded-2xl bg-neutral-900/60 backdrop-blur-sm border border-neutral-800 p-6"
      initial={{ opacity: 0, filter: 'blur(10px)' }}
      animate={{ opacity: 1, filter: 'blur(0px)' }}
      transition={{ duration: 0.6, delay: 0.18 }}
    >
      <h3 className="text-white font-medium text-base mb-1">What Off Grid has learned</h3>
      <p className="text-neutral-500 text-sm mb-4">
        Preferences distilled from the reasons you give when you dismiss a suggestion. This is the only learned text fed back to the assistant — it refreshes about once an hour, and raw notes are never used directly. You can remove any line you disagree with.
      </p>
      {lines.length ? (
        <ul className="divide-y divide-neutral-800/60 overflow-hidden rounded-xl border border-neutral-700/50 bg-neutral-800/40">
          {lines.map((line, i) => (
            <li key={i} className="group flex items-start gap-2 px-3 py-2">
              <span className="min-w-0 flex-1 whitespace-pre-wrap break-words font-mono text-sm leading-relaxed text-neutral-300">{line}</span>
              <button
                onClick={() => removeLine(i)}
                aria-label="Remove this line"
                title="Remove"
                className="mt-0.5 shrink-0 rounded p-0.5 text-neutral-600 transition-colors hover:bg-red-500/10 hover:text-red-400"
              >
                <X className="h-3.5 w-3.5" weight="bold" />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-xl border border-neutral-700/50 bg-neutral-800/40 p-3 text-sm text-neutral-600">
          Nothing learned yet. When you dismiss a suggestion, tell Off Grid why — it generalizes the useful ones here.
        </p>
      )}
      {lines.length > 0 && (
        <div className="mt-3">
          <button onClick={clear} className="rounded-lg px-3 py-1.5 text-xs text-neutral-500 hover:text-white">Clear all</button>
        </div>
      )}
    </motion.div>
  );
}


export function Settings() {
  // Pro/core aware: the proactive / secretary / fleet-console sections are Pro
  // and are hidden in the free build.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const isPro = !!(window as any).api?.isPro;
  const [idName, setIdName] = useState('');
  const [idEmail, setIdEmail] = useState('');
  const [appVersion, setAppVersion] = useState('');

  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window.api as any).getAppVersion?.().then((v: string) => setAppVersion(v || '')).catch(() => {});
  }, []);

  // Load identity on mount (Pro only — the handler lives in the pro layer).
  useEffect(() => {
    if (!isPro) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window.api as any).idGet?.().then((id: { name: string; email: string }) => {
      if (id) {
        setIdName(id.name || '');
        setIdEmail(id.email || '');
      }
    }).catch(() => {});
  }, [isPro]);

  const saveIdentity = (): void => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window.api as any).idSet?.({ name: idName.trim(), email: idEmail.trim() });
  };

  return (
    <div className="relative flex h-full flex-col">
      {/* Fixed header — stays put while the content below scrolls. */}
      <div className="flex shrink-0 items-center gap-3 border-b border-neutral-800/60 px-1 pb-4">
        <div className="h-10 w-10 rounded-xl bg-neutral-800 border border-neutral-700 flex items-center justify-center">
          <svg className="w-5 h-5 text-neutral-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        </div>
        <div>
          <h2 className="text-lg font-semibold text-white">Settings</h2>
          <p className="text-sm text-neutral-500">{isPro ? 'Who you are, what Off Grid has learned, and your devices' : 'Personalization & automation unlock with Pro'}</p>
        </div>
      </div>

      {/* Scrolling content below the fixed header */}
      <div className="relative flex-1 overflow-y-auto px-1 pt-5 pb-16">
        <motion.div
          className="flex flex-col gap-6"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.25, 0.46, 0.45, 0.94] }}
        >

          {/* Setup & health — available in every build. Re-run setup or check
              what's running at any time. */}
          <motion.div
            className="rounded-2xl bg-neutral-900/60 backdrop-blur-sm border border-neutral-800 p-6"
            initial={{ opacity: 0, filter: 'blur(10px)' }}
            animate={{ opacity: 1, filter: 'blur(0px)' }}
            transition={{ duration: 0.6, delay: 0.13 }}
          >
            <h3 className="text-white font-medium text-base mb-1">Setup &amp; health</h3>
            <p className="text-neutral-500 text-sm mb-4">
              Set up your local AI in one click, or browse models yourself. The status of every
              on-device component is shown live below.
            </p>
            <SetupPanel />
            <div className="mt-4">
              <StoragePanel />
            </div>
          </motion.div>

          {/* Identity — who you are (Pro: foundation for the act pillar) */}
          {isPro ? (
            <motion.div
              className="rounded-2xl bg-neutral-900/60 backdrop-blur-sm border border-neutral-800 p-6"
              initial={{ opacity: 0, filter: 'blur(10px)' }}
              animate={{ opacity: 1, filter: 'blur(0px)' }}
              transition={{ duration: 0.6, delay: 0.15 }}
            >
              <h3 className="text-white font-medium text-base mb-1">You</h3>
              <p className="text-neutral-500 text-sm mb-4">
                Tells Off Grid who “you” are — so it can tell your messages and commitments apart from everyone else’s. Used to attribute action items and to make sense of your email and calendar.
              </p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <input value={idName} onChange={(e) => setIdName(e.target.value)} onBlur={saveIdentity} placeholder="Your name" className="rounded-xl bg-neutral-950 border border-neutral-800 px-3 py-2 text-sm text-neutral-200 outline-none focus:border-neutral-600" />
                <input value={idEmail} onChange={(e) => setIdEmail(e.target.value)} onBlur={saveIdentity} placeholder="you@email.com" className="rounded-xl bg-neutral-950 border border-neutral-800 px-3 py-2 text-sm text-neutral-200 outline-none focus:border-neutral-600" />
              </div>
            </motion.div>
          ) : (
            <ProPlaceholder delay={0.15} title="You" description="Tell Off Grid who you are so it can attribute your messages, commitments, and calendar — part of the Pro intelligence layer." />
          )}

          {/* Pro sections — shown but disabled in the free build. */}
          {isPro ? <ProactiveSection /> : <ProPlaceholder title="Proactive delivery" description="A morning briefing and a heads-up before each meeting — native notifications, even when the window is closed." />}
          {isPro ? <SecretaryPrefs /> : <ProPlaceholder title="What Off Grid has learned" description="Preferences distilled from the suggestions you dismiss, fed back to your assistant so it gets sharper over time." />}

          {/* Data & privacy — one place to delete on-device data. */}
          <motion.div
            className="rounded-2xl bg-neutral-900/60 backdrop-blur-sm border border-neutral-800 p-6"
            initial={{ opacity: 0, filter: 'blur(10px)' }}
            animate={{ opacity: 1, filter: 'blur(0px)' }}
            transition={{ duration: 0.6, delay: 0.42 }}
          >
            <h3 className="text-white font-medium text-base mb-1">Data &amp; privacy</h3>
            <p className="text-neutral-500 text-sm mb-4">
              Everything stays on this device. Delete any of it from here — per category, or all at once.
            </p>
            <DataPrivacyPanel />
          </motion.div>

          {/* Version footer — so you always know which build you're on. */}
          <div className="flex items-center justify-center gap-2 pt-2 text-xs text-neutral-600">
            <span className="font-medium text-neutral-500">Off Grid AI</span>
            {appVersion && <span>v{appVersion}</span>}
          </div>
        </motion.div>
      </div>

      <ProgressiveBlur
        height="80px"
        position="bottom"
        className="pointer-events-none"
      />
    </div>
  );
}
