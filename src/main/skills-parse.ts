// Pure skill parsers extracted from skills.ts so the frontmatter parsing +
// trigger parsing + slug logic are unit-testable without fs / Electron (mirrors
// search-ranking.ts). No imports, no side effects. skills.ts re-imports these;
// the fs CRUD (readEntry / saveSkill / ...) stays there. Behaviour-neutral move.

// A skill can optionally fire on its own (trigger → action) instead of only
// being invoked manually with /name in chat:
//  • schedule — once a day at a local HH:MM
//  • keyword  — when a keyword appears in a newly captured observation
//  • event    — when a new calendar event or approval appears
export type SkillTrigger =
  | { kind: 'schedule'; at: string } // 'HH:MM' local time, daily
  | { kind: 'keyword'; keywords: string[] }
  | { kind: 'event'; on: 'calendar' | 'approval' }

export interface Skill {
  name: string
  description: string
  instructions: string
  // Automation (optional; absent = manual /name skill, unchanged behavior):
  trigger?: SkillTrigger
  action?: string // prompt run when triggered (falls back to instructions)
  connectors?: boolean // expose MCP connector tools to the action (default true)
}

/** Parse a trigger kind + its raw config string into a typed SkillTrigger.
 *  schedule → HH:MM (defaults 08:00 if malformed); keyword → non-empty CSV list
 *  (undefined if none); event → 'approval' | 'calendar'. Unknown kind → undefined. */
export function parseTrigger(kind: string, config: string): SkillTrigger | undefined {
  const c = config.trim()
  if (kind === 'schedule') return { kind: 'schedule', at: /^\d{1,2}:\d{2}$/.test(c) ? c : '08:00' }
  if (kind === 'keyword') {
    const keywords = c
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    return keywords.length ? { kind: 'keyword', keywords } : undefined
  }
  if (kind === 'event')
    return { kind: 'event', on: c.toLowerCase() === 'approval' ? 'approval' : 'calendar' }
  return undefined
}

/** Serialize a trigger back into frontmatter fields (inverse of parseTrigger). */
export function triggerToFrontmatter(t: SkillTrigger): { trigger: string; trigger_config: string } {
  if (t.kind === 'schedule') return { trigger: 'schedule', trigger_config: t.at }
  if (t.kind === 'keyword') return { trigger: 'keyword', trigger_config: t.keywords.join(', ') }
  return { trigger: 'event', trigger_config: t.on }
}

/** Parse `---\nname: ...\ndescription: ...\n---\n<body>` into its parts. Missing
 *  frontmatter → whole input is the body and fallbackName is the name. */
export function parseSkill(md: string, fallbackName: string): Skill {
  let name = fallbackName
  let description = ''
  let body = md
  let triggerKind = ''
  let triggerConfig = ''
  let action = ''
  let connectors = true
  const fm = /^\uFEFF?---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/.exec(md)
  if (fm) {
    // fm matched a 2-group pattern, so groups 1 and 2 are always present.
    body = fm[2]!
    for (const line of fm[1]!.split('\n')) {
      const m = /^\s*([A-Za-z_]+)\s*:\s*(.+?)\s*$/.exec(line)
      if (!m) continue
      const key = m[1]!.toLowerCase()
      const val = m[2]!.replace(/^["']|["']$/g, '')
      if (key === 'name') name = val
      else if (key === 'description') description = val
      else if (key === 'trigger') triggerKind = val.toLowerCase()
      else if (key === 'trigger_config') triggerConfig = val
      else if (key === 'action') action = val
      else if (key === 'connectors') connectors = val.toLowerCase() !== 'false'
    }
  }
  const skill: Skill = {
    name: name.trim(),
    description: description.trim(),
    instructions: body.trim()
  }
  const trigger = triggerKind ? parseTrigger(triggerKind, triggerConfig) : undefined
  if (trigger) {
    skill.trigger = trigger
    skill.action = action.trim()
    skill.connectors = connectors
  }
  return skill
}

/** Filesystem-safe slug for a skill name: lowercase, non-alphanumeric → '-',
 *  trimmed of leading/trailing dashes, capped at 60 chars; empty → 'skill'. */
export function slugify(name: string): string {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'skill'
  )
}
