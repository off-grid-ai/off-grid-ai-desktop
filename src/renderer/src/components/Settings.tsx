import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { LockKey, X, CheckCircle, Desktop, EnvelopeSimple, CaretDown } from '@phosphor-icons/react';
import { cn } from '@renderer/lib/utils';
import { ProgressiveBlur } from './ui/progressive-blur';
import { SetupPanel } from './setup/SetupPanel';
import { StoragePanel } from './setup/StoragePanel';
import { DataPrivacyPanel } from './setup/DataPrivacyPanel';

// Collapsible Settings card: same chrome as before, but the body is hidden until
// the user expands it (closed by default). The header shows the title always and a
// one-line summary while collapsed, with a chevron that flips when open. Keeps the
// long Settings sections scannable.
function SettingsCard({
  title,
  summary,
  defaultOpen = false,
  children,
  delay = 0.13,
}: {
  title: string;
  summary: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
  delay?: number;
}): React.ReactElement {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <motion.div
      className="overflow-hidden rounded-2xl border border-neutral-800 bg-neutral-900/60 backdrop-blur-sm"
      initial={{ opacity: 0, filter: 'blur(10px)' }}
      animate={{ opacity: 1, filter: 'blur(0px)' }}
      transition={{ duration: 0.6, delay }}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 p-6 text-left"
      >
        <div className="min-w-0 flex-1">
          <h3 className="text-base font-medium text-white">{title}</h3>
          {!open && <p className="mt-1 text-sm text-neutral-500">{summary}</p>}
        </div>
        <CaretDown className={cn('h-4 w-4 shrink-0 text-neutral-500 transition-transform', open && 'rotate-180')} />
      </button>
      {open && <div className="px-6 pb-6">{children}</div>}
    </motion.div>
  );
}

// A Pro section shown (disabled) in the free build: title + description + a
// "Pro" badge, dimmed and non-interactive.
function ProPlaceholder({ title, description, delay = 0.18 }: { title: string; description: string; delay?: number }): React.ReactElement {
  return (
    <motion.div
      className="relative rounded-2xl border border-neutral-800 bg-neutral-900/40 p-6"
      initial={{ opacity: 0, filter: 'blur(10px)' }}
      animate={{ opacity: 1, filter: 'blur(0px)' }}
      transition={{ duration: 0.6, delay }}
    >
      <span className="absolute right-4 top-4 inline-flex items-center gap-1 rounded-full border border-green-500/30 bg-green-500/10 px-2 py-0.5 text-[10px] uppercase tracking-wide text-green-400">
        <LockKey weight="bold" className="h-3 w-3" /> Pro
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
  // Body only — the card chrome + title come from SettingsCard.
  return (
    <div className="flex items-start justify-between gap-4">
      <p className="text-neutral-500 text-sm">
        Off Grid reaches out on its own - a morning briefing of your day and a heads-up ~20 min before each meeting with who is in it and your open items. Delivered as native notifications, even when the window is closed.
      </p>
      <button
        onClick={toggle}
        role="switch"
        aria-checked={enabled}
        className={`relative mt-1 inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${enabled ? 'bg-emerald-500' : 'bg-neutral-700'}`}
      >
        <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${enabled ? 'translate-x-6' : 'translate-x-1'}`} />
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Software update — current version, manual check, automatic-update toggle
// ---------------------------------------------------------------------------

// Runtime residency — per-engine on-demand vs in-memory (core infra). On a 16GB
// Mac keeping a model warm trades RAM for latency; the queue evicts a warm model
// when another engine needs the memory, so 'resident' is safe to opt into.
const RESIDENCY_ROWS: { modality: 'llm' | 'image' | 'stt' | 'tts'; label: string; hint: string; locked?: boolean }[] = [
  { modality: 'llm', label: 'Chat model', locked: true, hint: 'The local LLM (gemma). Kept in memory because screen replay distills captures through it continuously - on-demand would thrash-reload ~5GB. It is still freed momentarily during image generation, then reloaded.' },
  { modality: 'image', label: 'Image generation', hint: 'Resident keeps the diffusion model warm (~45s cold to ~7s warm); on-demand frees it after each image.' },
  { modality: 'stt', label: 'Dictation (speech-to-text)', hint: 'Resident keeps Whisper warm for fast live text; on-demand loads per recording. Parakeet always loads per use.' },
  { modality: 'tts', label: 'Text-to-speech', hint: 'Resident keeps the voice model warm; on-demand frees ~330MB between phrases.' },
];

function RuntimeResidencySection(): React.ReactElement {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const api = (window as any).api;
  const [modes, setModes] = useState<Record<string, string>>({});
  useEffect(() => {
    api.residencyGet?.().then((m: Record<string, string>) => setModes(m || {})).catch(() => {});
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, []);
  const toggle = (modality: string, locked?: boolean): void => {
    if (locked) return; // locked modalities (chat model) stay in-memory — no toggle
    const next = modes[modality] === 'resident' ? 'on-demand' : 'resident';
    setModes((prev) => ({ ...prev, [modality]: next }));
    api.residencySet?.(modality, next);
  };
  return (
    <div>
      <p className="text-neutral-500 text-sm mb-4">
        Keep a model in memory for instant use, or load it on demand to free RAM. Only one heavy model runs at a
        time - when another engine needs the memory, a resident model is evicted and reloaded on its next use, so
        resident mode never hangs the machine. On-demand is the safe default on 16GB Macs.
      </p>
      <div className="flex flex-col divide-y divide-neutral-800">
        {RESIDENCY_ROWS.map((row) => {
          const resident = row.locked || modes[row.modality] === 'resident';
          return (
            <div key={row.modality} className="flex items-start justify-between gap-4 py-3 first:pt-0">
              <div>
                <div className="text-sm text-neutral-200">{row.label}</div>
                <div className="text-xs text-neutral-600">{row.hint}</div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className={`text-[11px] tabular-nums ${resident ? 'text-emerald-400' : 'text-neutral-500'}`}>
                  {row.locked ? 'in-memory (required)' : resident ? 'in-memory' : 'on-demand'}
                </span>
                <button
                  onClick={() => toggle(row.modality, row.locked)}
                  role="switch"
                  aria-checked={resident}
                  aria-disabled={row.locked}
                  disabled={row.locked}
                  title={row.locked ? 'Required in memory — screen replay depends on this model' : undefined}
                  aria-label={`${row.label} residency`}
                  className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${resident ? 'bg-emerald-500' : 'bg-neutral-700'} ${row.locked ? 'cursor-not-allowed opacity-50' : ''}`}
                >
                  <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${resident ? 'translate-x-6' : 'translate-x-1'}`} />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SoftwareUpdateSection(): React.ReactElement {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const api = (window as any).api;
  const [auto, setAuto] = useState(true);
  const [beta, setBeta] = useState(false);
  const [version, setVersion] = useState('');
  const [checking, setChecking] = useState(false);
  const [status, setStatus] = useState('');
  useEffect(() => {
    api.updateGetPrefs?.().then((p: { currentVersion?: string; auto?: boolean; channel?: string }) => {
      setVersion(p?.currentVersion ?? '');
      setAuto(p?.auto !== false);
      setBeta(p?.channel === 'beta');
    }).catch(() => {});
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, []);
  const toggle = (): void => {
    const next = !auto;
    setAuto(next);
    api.updateSetAuto?.(next);
  };
  const toggleBeta = (): void => {
    const next = !beta;
    setBeta(next);
    api.updateSetChannel?.(next ? 'beta' : 'stable');
    setStatus(next
      ? 'Switched to nightly builds — these ship on every change and are pre-release. Turn this off to return to stable.'
      : 'Back on stable builds. You will move to the latest stable version on the next check.');
  };
  const check = async (): Promise<void> => {
    setChecking(true);
    setStatus('Checking for updates...');
    try {
      const r = await api.checkForUpdates?.();
      if (!r) setStatus('Could not check right now.');
      else if (r.status === 'available') setStatus(`Update ${r.version} found. Downloading in the background - you'll get a "Restart to update" prompt when it's ready.`);
      else if (r.status === 'not-available') setStatus(`You're on the latest version (v${r.version}).`);
      else setStatus(`Could not check: ${r.error}`);
    } catch {
      setStatus('Could not check right now.');
    } finally {
      setChecking(false);
    }
  };
  // Body only — the card chrome + title come from SettingsCard.
  return (
    <div>
      <div className="flex items-start justify-between gap-4">
        <p className="text-neutral-500 text-sm">
          Off Grid checks for updates in the background and installs them when you quit. Turn this off to update only when you choose.
        </p>
        <button
          onClick={toggle}
          role="switch"
          aria-checked={auto}
          className={`relative mt-1 inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${auto ? 'bg-emerald-500' : 'bg-neutral-700'}`}
        >
          <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${auto ? 'translate-x-6' : 'translate-x-1'}`} />
        </button>
      </div>
      <div className="mt-4 flex items-start justify-between gap-4 border-t border-neutral-800 pt-4">
        <p className="text-neutral-500 text-sm">
          Get nightly builds. New features land here first, on every change, before they reach stable. These are pre-release - expect rough edges. Off by default.
        </p>
        <button
          onClick={toggleBeta}
          role="switch"
          aria-checked={beta}
          className={`relative mt-1 inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${beta ? 'bg-emerald-500' : 'bg-neutral-700'}`}
        >
          <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${beta ? 'translate-x-6' : 'translate-x-1'}`} />
        </button>
      </div>
      <div className="mt-4 flex items-center gap-3">
        <button
          onClick={check}
          disabled={checking}
          className="rounded-lg border border-neutral-700 px-3 py-1.5 text-xs text-neutral-200 transition-colors hover:border-neutral-500 disabled:opacity-60"
        >
          {checking ? 'Checking...' : 'Check for updates'}
        </button>
        {version && <span className="text-xs text-neutral-600">Current: v{version}</span>}
      </div>
      {status && <p className="mt-2 text-xs text-neutral-500">{status}</p>}
    </div>
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
  // no free-form editing. Always persist as normalized "- " bullet lines.
  const lines = doc.split('\n').map((l) => l.trim()).filter(Boolean);
  const toBullets = (ls: string[]): string =>
    ls.map((l) => l.replace(/^[-•*]\s*/, '').trim()).filter(Boolean).map((t) => `- ${t}`).join('\n');
  const removeLine = async (idx: number): Promise<void> => {
    const next = toBullets(lines.filter((_, i) => i !== idx));
    setDoc(next);
    await api.secretaryPrefsSet?.(next);
  };
  const clear = async (): Promise<void> => { setDoc(''); await api.secretaryPrefsSet?.(''); };

  // Body only — the card chrome + title come from SettingsCard.
  return (
    <div>
      <p className="text-neutral-500 text-sm mb-4">
        Preferences distilled from the reasons you give when you dismiss a suggestion. This is the only learned text fed back to the assistant - it refreshes about once an hour, and raw notes are never used directly. You can remove any line you disagree with.
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
          Nothing learned yet. When you dismiss a suggestion, tell Off Grid why - it generalizes the useful ones here.
        </p>
      )}
      {lines.length > 0 && (
        <div className="mt-3">
          <button onClick={clear} className="rounded-lg px-3 py-1.5 text-xs text-neutral-500 hover:text-white">Clear all</button>
        </div>
      )}
    </div>
  );
}

const MAX_DEVICES = 5;
interface PlanInfo { isPro: boolean; tier: 'lifetime' | 'monthly' | null; expiry: string | null }
interface PlanDevice { id: string; name?: string; platform?: string; lastSeen?: string }

// Pro plan + devices, mirroring mobile's ProManageSection. Read-only device list
// (the cap is fixed, no self-service removal); for monthly, the cancel/update path
// is the link in the purchase/renewal email (no in-app billing portal).
function ProPlanSection(): React.ReactElement {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const api = (window as any).api;
  const [info, setInfo] = useState<PlanInfo | null>(null);
  const [devices, setDevices] = useState<PlanDevice[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let live = true;
    void Promise.all([api?.license?.status?.(), api?.license?.listDevices?.()])
      .then(([i, d]: [PlanInfo, PlanDevice[]]) => { if (!live) return; setInfo(i ?? null); setDevices(Array.isArray(d) ? d : []); })
      .catch(() => {})
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [api]);

  const fmt = (iso?: string | null): string => {
    if (!iso) return '';
    try { return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }); } catch { return iso; }
  };
  const statusLine = info?.tier === 'lifetime' ? 'Lifetime · never expires'
    : info?.tier === 'monthly' ? `Monthly · active until ${fmt(info.expiry)}`
    : 'Pro active';

  // Body only — the card chrome + title come from SettingsCard.
  return (
    <div>
      {loading ? (
        <p className="text-sm text-neutral-600">Loading…</p>
      ) : (
        <>
          <div className="flex items-center gap-2 text-sm text-neutral-200">
            <CheckCircle weight="fill" className="h-4 w-4 text-green-500" /> {statusLine}
          </div>

          <div className="mt-5">
            <div className="text-[11px] uppercase tracking-wide text-neutral-500">Devices ({devices.length} of {MAX_DEVICES})</div>
            <p className="mt-0.5 text-[11px] text-neutral-600">A license works on up to {MAX_DEVICES} devices. This limit is fixed.</p>
            <ul className="mt-2 divide-y divide-neutral-800/60 overflow-hidden rounded-xl border border-neutral-800 bg-neutral-950/40">
              {devices.length === 0 ? (
                <li className="px-3 py-2 text-sm text-neutral-600">No devices registered yet.</li>
              ) : devices.map((m) => (
                <li key={m.id} className="flex items-center gap-2.5 px-3 py-2">
                  <Desktop className="h-4 w-4 shrink-0 text-neutral-500" />
                  <span className="min-w-0 flex-1 truncate text-sm text-neutral-300">{m.name || m.platform || 'Device'}</span>
                  {m.lastSeen && <span className="shrink-0 text-[11px] text-neutral-600">Added {fmt(m.lastSeen)}</span>}
                </li>
              ))}
            </ul>
          </div>

          {info?.tier === 'monthly' && (
            <div className="mt-5">
              <div className="text-[11px] uppercase tracking-wide text-neutral-500">Manage subscription</div>
              <p className="mt-1 flex items-start gap-2 text-[11px] text-neutral-500">
                <EnvelopeSimple className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                To cancel or update your payment method, use the link in your Off Grid purchase or renewal email - one is sent with every payment.
              </p>
            </div>
          )}
        </>
      )}
    </div>
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

          {/* Each section is a collapsed-by-default accordion (SettingsCard). */}
          <SettingsCard title="Setup & health" summary="Set up your local AI, manage storage, and see live component health." delay={0.13}>
            <SetupPanel />
            <div className="mt-4">
              <StoragePanel />
            </div>
          </SettingsCard>

          {/* Identity — who you are (Pro: foundation for the act pillar) */}
          {isPro ? (
            <SettingsCard title="You" summary="Who you are, so Off Grid can attribute your messages and calendar." delay={0.15}>
              <p className="text-neutral-500 text-sm mb-4">
                Tells Off Grid who you are - so it can tell your messages and commitments apart from everyone else&apos;s. Used to attribute action items and to make sense of your email and calendar.
              </p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <input value={idName} onChange={(e) => setIdName(e.target.value)} onBlur={saveIdentity} placeholder="Your name" className="rounded-xl bg-neutral-950 border border-neutral-800 px-3 py-2 text-sm text-neutral-200 outline-none focus:border-neutral-600" />
                <input value={idEmail} onChange={(e) => setIdEmail(e.target.value)} onBlur={saveIdentity} placeholder="you@email.com" className="rounded-xl bg-neutral-950 border border-neutral-800 px-3 py-2 text-sm text-neutral-200 outline-none focus:border-neutral-600" />
              </div>
            </SettingsCard>
          ) : (
            <ProPlaceholder delay={0.15} title="You" description="Tell Off Grid who you are so it can attribute your messages, commitments, and calendar - part of the Pro intelligence layer." />
          )}

          {/* Pro sections — shown but disabled in the free build. */}
          {isPro ? (
            <SettingsCard title="Proactive delivery" summary="A morning briefing and a heads-up before each meeting." delay={0.18}>
              <ProactiveSection />
            </SettingsCard>
          ) : (
            <ProPlaceholder title="Proactive delivery" description="A morning briefing and a heads-up before each meeting - native notifications, even when the window is closed." />
          )}
          {isPro ? (
            <SettingsCard title="What Off Grid has learned" summary="Preferences distilled from your dismissals, fed back to the assistant." delay={0.22}>
              <SecretaryPrefs />
            </SettingsCard>
          ) : (
            <ProPlaceholder title="What Off Grid has learned" description="Preferences distilled from the suggestions you dismiss, fed back to your assistant so it gets sharper over time." />
          )}
          {isPro && (
            <SettingsCard title="Your Pro plan" summary="Your subscription, devices, and how to cancel." delay={0.3}>
              <ProPlanSection />
            </SettingsCard>
          )}

          {/* Data & privacy — one place to delete on-device data. */}
          <SettingsCard title="Data & privacy" summary="See and delete on-device data, per category or all at once." delay={0.42}>
            <DataPrivacyPanel />
          </SettingsCard>

          {/* Runtime residency — per-engine in-memory vs on-demand (core infra). */}
          <SettingsCard title="Model memory" summary="Keep each engine warm for speed, or load on demand to free RAM." delay={0.44}>
            <RuntimeResidencySection />
          </SettingsCard>

          {/* Software update — check for updates + automatic-update control (core). */}
          <SettingsCard title="Software update" summary="Check for updates and choose whether they install automatically." delay={0.46}>
            <SoftwareUpdateSection />
          </SettingsCard>

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
