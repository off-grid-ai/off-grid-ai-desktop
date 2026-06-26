import { useState } from 'react';
import { ArrowSquareOut, Check, Sparkle, Key, CircleNotch } from '@phosphor-icons/react';
import { PRO_PAY_URL, PRO_FEATURES, type ProFeature } from './proCatalog';

const PRO_DOWNLOAD_URL = 'https://github.com/off-grid-ai/desktop/releases/latest';

// License-key activation. Only meaningful in a pro-capable build (__OFFGRID_PRO__);
// a core build has no pro code bundled, so entering a key would unlock nothing.
// On success the cached entitlement flips, but main-process pro features (tray,
// capture, CRM loops) only attach at boot — so we offer a relaunch.
function LicenseActivation(): React.ReactElement {
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const activate = async (): Promise<void> => {
    const license = window.api?.license;
    if (!license || !key.trim()) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await license.activate(key.trim());
      if (r.ok) {
        setMsg({ kind: 'ok', text: 'Activated. Restart to finish unlocking Pro.' });
      } else {
        const text =
          r.reason === 'limit'
            ? 'This license is already on the maximum number of devices. Deactivate one and try again.'
            : r.reason === 'network'
              ? 'Could not reach the licensing server. Check your connection and try again.'
              : 'That license key is invalid, expired, or revoked.';
        setMsg({ kind: 'err', text });
      }
    } catch {
      setMsg({ kind: 'err', text: 'Activation failed. Please try again.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-2 flex w-full max-w-md flex-col items-stretch gap-2">
      <label className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-neutral-500">
        <Key weight="bold" className="h-3.5 w-3.5" /> Already bought Pro? Enter your license key
      </label>
      <div className="flex gap-2">
        <input
          value={key}
          onChange={(e) => setKey(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !busy && activate()}
          placeholder="XXXX-XXXX-XXXX-XXXX"
          spellCheck={false}
          autoCapitalize="characters"
          className="flex-1 rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-white placeholder:text-neutral-600 focus:border-green-500/60 focus:outline-none"
        />
        <button
          onClick={activate}
          disabled={busy || !key.trim()}
          className="inline-flex items-center gap-2 rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-green-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? <CircleNotch weight="bold" className="h-4 w-4 animate-spin" /> : 'Activate'}
        </button>
      </div>
      {msg && (
        <div className={`flex items-center justify-between gap-3 text-left text-xs ${msg.kind === 'ok' ? 'text-green-400' : 'text-red-400'}`}>
          <span>{msg.text}</span>
          {msg.kind === 'ok' && (
            <button
              onClick={() => window.api?.license?.relaunch()}
              className="shrink-0 rounded-md border border-green-500/40 px-2.5 py-1 font-medium text-green-300 hover:bg-green-500/10"
            >
              Restart now
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// Shown in the free build when a Pro tab is opened. Pro is launching soon — this
// writes up what the feature will do and points to early access (free waitlist)
// or paying now (lifetime free + first access). People who've already paid are
// reassured they're first in line.
export function UpgradeScreen({ feature }: { feature?: ProFeature }): React.ReactElement {
  const f = feature;
  const open = (url: string): void => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const api = (window as any).api;
    if (api?.openExternal) api.openExternal(url);
    else window.open(url, '_blank');
  };

  return (
    <div className="mx-auto flex h-full max-w-3xl flex-col items-center justify-center gap-6 px-6 text-center font-mono">
      <span className="inline-flex items-center gap-1.5 rounded-full border border-green-500/30 bg-green-500/10 px-3 py-1 text-xs uppercase tracking-wide text-green-400">
        <Sparkle weight="fill" className="h-3.5 w-3.5" /> Off Grid Pro · Available now
      </span>

      {f ? (
        <>
          <div className="flex flex-col items-center gap-3">
            <f.icon weight="duotone" className="h-12 w-12 text-green-400" />
            <h1 className="text-2xl font-semibold text-white">{f.label}</h1>
            <p className="text-base text-neutral-300">{f.tagline}</p>
          </div>
          <p className="max-w-xl text-sm leading-relaxed text-neutral-400">{f.description}</p>
          <ul className="flex flex-col items-start gap-2 text-left">
            {f.highlights.map((h) => (
              <li key={h} className="flex items-start gap-2 text-sm text-neutral-300">
                <Check weight="bold" className="mt-0.5 h-4 w-4 shrink-0 text-green-400" /> {h}
              </li>
            ))}
          </ul>
        </>
      ) : (
        <div className="flex flex-col items-center gap-3">
          <h1 className="text-2xl font-semibold text-white">Off Grid Pro is here</h1>
          <p className="max-w-xl text-sm leading-relaxed text-neutral-400">
            Pro adds the layer that sees, remembers, and acts — always on, it never forgets,
            makes everything findable with unified search, and a proactive secretary surfaces
            what matters and acts for you. Screen capture, your private CRM, meetings, and
            connectors included. All on-device.
          </p>
        </div>
      )}

      <div className="mt-2 flex flex-col items-center gap-3 sm:flex-row">
        <button
          onClick={() => open(PRO_PAY_URL)}
          className="inline-flex items-center gap-2 rounded-lg bg-green-600 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-green-500"
        >
          Get Pro <ArrowSquareOut weight="bold" className="h-4 w-4" />
        </button>
        <button
          onClick={() => open(PRO_DOWNLOAD_URL)}
          className="inline-flex items-center gap-2 rounded-lg border border-neutral-700 px-5 py-2.5 text-sm font-medium text-neutral-200 transition-colors hover:border-green-500/60 hover:text-white"
        >
          Download the Pro build <ArrowSquareOut weight="bold" className="h-4 w-4" />
        </button>
      </div>

      {__OFFGRID_PRO__ ? (
        <LicenseActivation />
      ) : (
        <p className="max-w-md text-xs leading-relaxed text-neutral-500">
          Already bought Pro? Download the Pro build above and activate your license key in it.
        </p>
      )}

      <div className="mt-1 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[11px] text-neutral-600">
        {PRO_FEATURES.map((x) => (
          <span key={x.route} className={x.route === f?.route ? 'text-green-400' : ''}>
            {x.label}
          </span>
        ))}
      </div>
    </div>
  );
}
