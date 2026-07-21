// Pure tag-filter logic for the Models screen, isolated so it unit-tests without the
// 900-line component. A model matches when it carries EVERY selected tag (AND — each
// chip narrows the list); an empty selection matches everything.

/** Unique tags across a set of models, in first-seen order — the chips to offer. */
export function collectTags(models: ReadonlyArray<{ tags?: string[] }>): string[] {
  const seen = new Set<string>()
  for (const m of models) {
    for (const t of m.tags ?? []) {
      seen.add(t)
    }
  }
  return [...seen]
}

/** True if the model carries every selected tag. Empty selection = match all. */
export function matchesAllTags(
  modelTags: readonly string[] | undefined,
  selected: readonly string[]
): boolean {
  if (selected.length === 0) {
    return true
  }
  const have = new Set(modelTags ?? [])
  return selected.every((t) => have.has(t))
}

/** Toggle a tag in the selection (add if absent, remove if present). */
export function toggleTag(selected: readonly string[], tag: string): string[] {
  return selected.includes(tag) ? selected.filter((t) => t !== tag) : [...selected, tag]
}
