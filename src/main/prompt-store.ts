import { deleteSetting, getSetting } from './database'
import { fillTemplate, getDefaultPromptTemplate } from './prompts'

/** Returns the user-customized template if one exists, otherwise the default. */
export function getPromptTemplate(key: string): string {
  const defaultTemplate = getDefaultPromptTemplate(key)
  return getSetting<string>(`prompt:${key}`, defaultTemplate)
}

/** Gets the effective template for `key` and fills it with `vars`. */
export function getPrompt(key: string, vars: Record<string, string>): string {
  return fillTemplate(getPromptTemplate(key), vars)
}

/** Deletes a custom override so the prompt reverts to its default. */
export function resetPrompt(key: string): void {
  deleteSetting(`prompt:${key}`)
}
