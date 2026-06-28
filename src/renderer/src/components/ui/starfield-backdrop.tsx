import { cn } from '@renderer/lib/utils';

/** Starry-night layer over the terminal grid, in BOTH themes (themeable dots:
 *  dark on light, bright on dark — see .og-starfield in main.css), plus a periodic
 *  emerald shooting star (.og-shooting-star). Pure CSS, no deps, pointer-events-none
 *  so it never intercepts clicks. Respects prefers-reduced-motion. */
export function StarfieldBackdrop({ className }: { className?: string }): React.ReactElement {
  return (
    <div
      aria-hidden
      className={cn('pointer-events-none absolute inset-0 overflow-hidden', className)}
    >
      <div className="og-starfield absolute inset-0" />
      <span className="og-shooting-star" />
    </div>
  );
}
