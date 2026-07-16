import { useCallback, useEffect, useState } from 'react'
import {
  CheckCircle,
  CircleNotch,
  WarningCircle,
  Circle,
  ArrowsClockwise
} from '@phosphor-icons/react'
import { cn } from '@renderer/lib/utils'

type ComponentStatus = 'ready' | 'starting' | 'down' | 'not_installed'

interface HealthComponent {
  id: string
  label: string
  status: ComponentStatus
  detail?: string
  port?: number
  canRestart?: boolean
}

interface SystemHealth {
  ramGb: number
  activeModel: string | null
  components: HealthComponent[]
}

// Emerald is the only accent (DESIGN): healthy = emerald, everything else reads
// through opacity tiers + icon shape, never a status color palette.
const STATUS_META: Record<ComponentStatus, { label: string; text: string }> = {
  ready: { label: 'Running', text: 'text-green-500' },
  starting: { label: 'Starting', text: 'text-neutral-400' },
  down: { label: 'Down', text: 'text-neutral-300' },
  not_installed: { label: 'Not set up', text: 'text-neutral-500' }
}

function StatusIcon({ status }: { status: ComponentStatus }): React.ReactElement {
  if (status === 'ready') return <CheckCircle weight="fill" className="h-4 w-4 text-green-500" />
  if (status === 'starting')
    return <CircleNotch className="h-4 w-4 animate-spin text-neutral-400" />
  if (status === 'down') return <WarningCircle weight="fill" className="h-4 w-4 text-neutral-300" />
  return <Circle className="h-4 w-4 text-neutral-600" />
}

/** Live status of every local component. Polls system:health on an interval. */
export function HealthPanel(): React.ReactElement {
  const api = (window as { api?: Record<string, (...args: unknown[]) => Promise<unknown>> }).api
  const [health, setHealth] = useState<SystemHealth | null>(null)
  const [restarting, setRestarting] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const h = (await api?.systemHealth?.()) as SystemHealth | undefined
      if (h) setHealth(h)
    } catch {
      /* ignore — keep last snapshot */
    }
  }, [api])

  useEffect(() => {
    refresh()
    const t = setInterval(refresh, 3000)
    return () => clearInterval(t)
  }, [refresh])

  const restart = async (id: string): Promise<void> => {
    setRestarting(id)
    try {
      await api?.restartComponent?.(id)
      await refresh()
    } finally {
      setRestarting(null)
    }
  }

  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900/40 font-mono">
      <div className="flex items-center justify-between border-b border-neutral-800/60 px-4 py-3">
        <div className="text-[10px] font-medium uppercase tracking-widest text-neutral-500">
          System health
        </div>
        <button
          onClick={refresh}
          className="flex items-center gap-1.5 text-[11px] text-neutral-500 transition-colors hover:text-white"
        >
          <ArrowsClockwise className="h-3 w-3" />
          Refresh
        </button>
      </div>

      {!health ? (
        <div className="px-4 py-6 text-center text-xs text-neutral-600">Checking components…</div>
      ) : (
        <div className="grid grid-cols-1 gap-1.5 p-3 sm:grid-cols-2 lg:grid-cols-3">
          {health.components.map((c) => {
            const meta = STATUS_META[c.status]
            const canRestart = c.canRestart && (c.status === 'down' || c.status === 'ready')
            return (
              <div
                key={c.id}
                className="group flex items-center gap-2.5 rounded border border-neutral-800/60 bg-neutral-900/30 px-2.5 py-2 transition-colors duration-150 hover:border-neutral-700"
              >
                <StatusIcon status={c.status} />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-mono text-[11px] text-neutral-200">{c.label}</div>
                  {c.detail && (
                    <div className="truncate text-[10px] text-neutral-600">{c.detail}</div>
                  )}
                </div>
                {c.port && (
                  <span className="shrink-0 font-mono text-[9px] text-neutral-600">:{c.port}</span>
                )}
                <span className={cn('shrink-0 text-[10px]', meta.text)}>{meta.label}</span>
                {canRestart && (
                  <button
                    onClick={() => restart(c.id)}
                    disabled={restarting === c.id}
                    className="shrink-0 rounded border border-neutral-700 px-1.5 py-0.5 text-[9px] leading-4 text-neutral-300 transition-all duration-150 hover:border-green-500/60 hover:text-white active:scale-95 disabled:opacity-50"
                  >
                    {restarting === c.id ? '…' : 'Restart'}
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}

      {health && (
        <div className="border-t border-neutral-800/60 px-4 py-2 text-[10px] text-neutral-600">
          {health.ramGb} GB RAM{health.activeModel ? ` · active: ${health.activeModel}` : ''}
        </div>
      )}
    </div>
  )
}
