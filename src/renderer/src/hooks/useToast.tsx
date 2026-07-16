import { createContext, useContext, useState, useCallback, useRef, type ReactNode } from 'react'
import { IconCheck, IconX } from '@tabler/icons-react'

// Transient top-right toast with an optional action (e.g. Undo). Distinct from
// the persistent notification center (useNotifications): a toast auto-dismisses
// and is for momentary "X was done — Undo" confirmations. Generic shell infra,
// usable from core and pro screens alike.

interface Toast {
  id: string
  message: string
  actionLabel?: string
  onAction?: () => void
}

interface ToastContextType {
  showToast: (t: {
    message: string
    actionLabel?: string
    onAction?: () => void
    durationMs?: number
  }) => void
}

const ToastContext = createContext<ToastContextType | undefined>(undefined)

const DEFAULT_DURATION = 6000

export function ToastProvider({ children }: { children: ReactNode }): React.ReactElement {
  const [toasts, setToasts] = useState<Toast[]>([])
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
    const timer = timers.current[id]
    if (timer) {
      clearTimeout(timer)
      delete timers.current[id]
    }
  }, [])

  const showToast = useCallback<ToastContextType['showToast']>(
    ({ message, actionLabel, onAction, durationMs }) => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
      setToasts((prev) => [{ id, message, actionLabel, onAction }, ...prev].slice(0, 4))
      timers.current[id] = setTimeout(() => dismiss(id), durationMs ?? DEFAULT_DURATION)
    },
    [dismiss]
  )

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div className="pointer-events-none fixed right-4 top-4 z-[60] flex flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className="pointer-events-auto flex items-center gap-3 rounded-md border border-neutral-800 bg-neutral-900/95 px-3.5 py-2 font-mono text-xs text-neutral-200 shadow-xl backdrop-blur"
          >
            <IconCheck className="h-4 w-4 shrink-0 text-green-500" />
            <span className="max-w-[22rem] truncate">{t.message}</span>
            {t.actionLabel && t.onAction && (
              <button
                onClick={() => {
                  t.onAction?.()
                  dismiss(t.id)
                }}
                className="shrink-0 rounded-sm border border-green-500/50 bg-green-500/10 px-2 py-0.5 text-green-400 hover:bg-green-500/20"
              >
                {t.actionLabel}
              </button>
            )}
            <button
              onClick={() => dismiss(t.id)}
              aria-label="Dismiss"
              className="shrink-0 text-neutral-600 hover:text-neutral-300"
            >
              <IconX className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast(): ToastContextType {
  const ctx = useContext(ToastContext)
  if (ctx === undefined) throw new Error('useToast must be used within a ToastProvider')
  return ctx
}
