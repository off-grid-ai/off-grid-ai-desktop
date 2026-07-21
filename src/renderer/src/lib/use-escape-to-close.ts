import { useEffect } from 'react'

// Dismiss-on-Escape for overlays/panels/slide-overs. One place so every panel dismisses
// the same way (Escape closes), instead of each re-implementing a keydown listener.
export function useEscapeToClose(onClose: () => void): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
}
