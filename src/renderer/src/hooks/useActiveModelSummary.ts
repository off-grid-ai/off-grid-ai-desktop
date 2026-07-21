import { useEffect, useState } from 'react'
import { formatContextWindow, resolveModelName } from '../lib/model-summary'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const api = (window as { api?: any }).api

export interface ActiveModelSummary {
  /** Display name of the active text/vision model, or null if none. */
  name: string | null
  /** Compact running context window, e.g. "8K", or null if unknown. */
  ctx: string | null
}

/** Read the active text model + its running context window for the composer indicator.
 *  Pass a value that changes when the model may have changed (e.g. the model-picker
 *  open flag) so the chip refreshes after a switch. All formatting lives in the pure
 *  model-summary helpers; this hook only does the IPC reads. */
export function useActiveModelSummary(refreshWhen: unknown): ActiveModelSummary {
  const [summary, setSummary] = useState<ActiveModelSummary>({ name: null, ctx: null })

  useEffect(() => {
    let live = true
    void (async () => {
      const catalog = await api?.getModelCatalog?.()
      const activeId = (await api?.getActiveModel?.()) ?? null
      const settings = await api?.getLlmSettings?.()
      if (!live) {
        return
      }
      setSummary({
        name: resolveModelName(catalog?.models ?? [], activeId),
        ctx: formatContextWindow(settings?.ctxSize)
      })
    })()
    return () => {
      live = false
    }
  }, [refreshWhen])

  return summary
}
