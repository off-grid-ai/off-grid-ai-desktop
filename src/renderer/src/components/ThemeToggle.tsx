import { useState } from 'react';
import { Sun, Moon, Monitor } from '@phosphor-icons/react';
import { cn } from '@renderer/lib/utils';
import { getThemeMode, setThemeMode, type ThemeMode } from '../theme';

// Theme switch (system -> light -> dark -> system).
const ORDER: ThemeMode[] = ['system', 'light', 'dark'];
const ICON = { system: Monitor, light: Sun, dark: Moon };
const LABEL = { system: 'System', light: 'Light', dark: 'Dark' };

/** Theme cycle styled as a left-nav item (icon-only when collapsed, icon+label
 *  when expanded) — matches the other nav buttons in App.tsx. */
export function NavThemeToggle({ expanded }: { expanded: boolean }): React.ReactElement {
  const [mode, setMode] = useState<ThemeMode>(getThemeMode());
  const Icon = ICON[mode];
  const cycle = (): void => {
    const next = ORDER[(ORDER.indexOf(mode) + 1) % ORDER.length];
    setThemeMode(next);
    setMode(next);
  };
  return (
    <button
      onClick={cycle}
      title={!expanded ? `Theme: ${LABEL[mode]}` : undefined}
      className={cn(
        'group/nav relative flex items-center gap-3 rounded-lg py-2 text-sm transition-colors',
        expanded ? 'px-3' : 'justify-center px-0',
        'text-neutral-500 hover:bg-neutral-500/10 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-white',
      )}
    >
      <Icon className="h-5 w-5 shrink-0" />
      {expanded && <span className="flex-1 text-left whitespace-pre">Theme: {LABEL[mode]}</span>}
    </button>
  );
}

export function ThemeToggle() {
  const [mode, setMode] = useState<ThemeMode>(getThemeMode());
  const Icon = ICON[mode];

  const cycle = (): void => {
    const next = ORDER[(ORDER.indexOf(mode) + 1) % ORDER.length];
    setThemeMode(next);
    setMode(next);
  };

  return (
    <button
      onClick={cycle}
      title={`Theme: ${LABEL[mode]} (click to change)`}
      className="fixed bottom-4 right-4 z-[100] flex items-center gap-1.5 rounded-md border border-neutral-800 bg-neutral-900/70 px-2.5 py-1.5 text-xs text-neutral-400 shadow-lg backdrop-blur-md transition-colors hover:border-green-500 hover:text-green-500"
      style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
    >
      <Icon className="h-3.5 w-3.5" />
      {LABEL[mode]}
    </button>
  );
}
