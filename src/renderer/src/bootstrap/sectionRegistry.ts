import type { ComponentType } from 'react'

// Settings-section seam. Pro registers Settings sections (proactive delivery,
// secretary preferences, fleet console) during activation; the core Settings
// screen renders its own sections + all registered ones. Mirrors
// mobile/src/components/settings/sectionRegistry.ts.

export interface SettingsSection {
  id: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  component: ComponentType<any>
  /** Card title shown in the Settings screen. */
  title?: string
  /** One-line summary shown while the card is collapsed. */
  summary?: string
  /** Lower sorts first. */
  order?: number
}

const sections: SettingsSection[] = []

export function registerSettingsSection(section: SettingsSection): void {
  if (!sections.some((s) => s.id === section.id)) sections.push(section)
}

export function getRegisteredSettingsSections(): SettingsSection[] {
  return [...sections].sort((a, b) => (a.order ?? 100) - (b.order ?? 100))
}
