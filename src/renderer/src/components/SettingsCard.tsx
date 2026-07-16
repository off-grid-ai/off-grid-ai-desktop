import { useState } from 'react'
import { motion } from 'motion/react'
import { LockKey, CaretDown } from '@phosphor-icons/react'
import { cn } from '@renderer/lib/utils'

// Reusable Settings chrome, extracted from the Settings screen so both core and the
// pro package (pro/renderer/settings-sections.tsx) can render sections with the same
// card without importing the 2,600-line Settings.tsx (which drags SetupPanel/etc. and
// their window.api typings into the pro typecheck). Light deps only.

// Collapsible Settings card: the body is hidden until the user expands it (closed by
// default). The header shows the title always and a one-line summary while collapsed,
// with a chevron that flips when open. Keeps the long Settings sections scannable.
export function SettingsCard({
  title,
  summary,
  defaultOpen = false,
  children,
  delay = 0.13
}: {
  title: string
  summary: string
  defaultOpen?: boolean
  children: React.ReactNode
  delay?: number
}): React.ReactElement {
  const [open, setOpen] = useState(defaultOpen)
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
        <CaretDown
          className={cn(
            'h-4 w-4 shrink-0 text-neutral-500 transition-transform',
            open && 'rotate-180'
          )}
        />
      </button>
      {open && <div className="px-6 pb-6">{children}</div>}
    </motion.div>
  )
}

// A Pro section shown (disabled) in the free build: title + description + a "Pro"
// badge, dimmed and non-interactive.
export function ProPlaceholder({
  title,
  description,
  delay = 0.18
}: {
  title: string
  description: string
  delay?: number
}): React.ReactElement {
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
  )
}
