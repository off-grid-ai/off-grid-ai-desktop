import { createContext, useContext } from 'react'

interface ToastRequest {
  message: string
  actionLabel?: string
  onAction?: () => void
  durationMs?: number
}

export interface ToastContextType {
  showToast: (toast: ToastRequest) => void
}

export const ToastContext = createContext<ToastContextType | undefined>(undefined)

export function useToast(): ToastContextType {
  const context = useContext(ToastContext)
  if (context === undefined) throw new Error('useToast must be used within a ToastProvider')
  return context
}
