import { createContext, useContext } from 'react'
import type { Notification, NotificationInput } from './notification-state'

export interface NotificationContextType {
  notifications: Notification[]
  unreadCount: number
  addNotification: (notification: NotificationInput) => void
  markAsRead: (id: string) => void
  markAllAsRead: () => void
  clearNotification: (id: string) => void
  clearAll: () => void
}

export const NotificationContext = createContext<NotificationContextType | undefined>(undefined)

export function useNotifications(): NotificationContextType {
  const context = useContext(NotificationContext)
  if (context === undefined) {
    throw new Error('useNotifications must be used within a NotificationProvider')
  }
  return context
}

export type { Notification } from './notification-state'
