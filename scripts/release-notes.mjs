#!/usr/bin/env node
// Build consumer-facing release notes from conventional-commit subjects.
//
// Usage:
//   node scripts/release-notes.mjs <prevTag> <version> <repo> [toRef]
//   - prevTag: previous release tag, or "" for the first release
//   - version: the version being released, WITHOUT the leading "v" (e.g. 0.0.33)
//   - repo:    owner/name (for the Full Changelog compare link)
//   - toRef:   end of the range (default HEAD). CI omits it; backfill passes the
//              tag being documented (e.g. v0.0.25) so it reads prevTag..v0.0.25.
//
// Reads `git log <prevTag>..HEAD` itself, so it is the single source of truth for
// both the CI step and the backfill. Output goes to stdout (the workflow redirects
// it to release-notes.md). No network, no API key, deterministic.
//
// Shape:
//   ## Highlights         <- the human-readable summary (grouped, plain language)
//   **New** / **Fixes**
//   ## What's Changed     <- the full commit list (same as before)
//   **Full Changelog**: …

import { execSync } from 'node:child_process'

const [prevTag = '', version = '0.0.0', repo = '', toRef = 'HEAD'] = process.argv.slice(2)

// Commit types that mean something to a person using the app. Everything else
// (chore, ci, docs, test, refactor, style, build, wip, snapshot) is internal and
// stays out of the human summary - it still shows in the raw commit list below.
const TYPE_GROUP = { feat: 'New', fix: 'Fixes', perf: 'Fixes' }

const range = prevTag ? `${prevTag}..${toRef}` : toRef
const raw = execSync(
  // %s subject, %h short hash, tab-separated. Skip the bot version bump.
  `git log ${range} --no-merges --invert-grep --grep='\\[skip ci\\]' --pretty=format:'%s\t%h'`,
  { encoding: 'utf8' },
).trim()

const commits = raw ? raw.split('\n').map((l) => {
  const [subject, hash] = l.split('\t')
  return { subject, hash }
}) : []

// Turn a conventional-commit subject into a plain sentence a user can read.
function humanize(subject) {
  const m = subject.match(/^(\w+)(?:\(([^)]+)\))?!?:\s*(.+)$/)
  let text = m ? m[3] : subject
  text = text
    .replace(/\s*\(#\d+\)\s*$/, '')      // drop trailing PR refs: "(#11)"
    .replace(/[—–]/g, ' - ')    // em/en dash -> " - " (brand voice)
    .replace(/[‘’]/g, "'")      // curly -> straight
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, ' ')
    .trim()
  return text.charAt(0).toUpperCase() + text.slice(1)
}

function typeOf(subject) {
  const m = subject.match(/^(\w+)(?:\([^)]+\))?!?:/)
  return m ? m[1] : null
}

// Group the user-facing commits.
const groups = { New: [], Fixes: [] }
for (const c of commits) {
  const group = TYPE_GROUP[typeOf(c.subject)]
  if (group) groups[group].push(humanize(c.subject))
}

// De-dupe within a group (snapshots/rebases can repeat a subject).
for (const k of Object.keys(groups)) groups[k] = [...new Set(groups[k])]

const out = []
out.push('## Highlights', '')

const hasHighlights = groups.New.length || groups.Fixes.length
if (hasHighlights) {
  if (groups.New.length) {
    out.push('**New**', '')
    for (const line of groups.New) out.push(`- ${line}`)
    out.push('')
  }
  if (groups.Fixes.length) {
    out.push('**Fixes**', '')
    for (const line of groups.Fixes) out.push(`- ${line}`)
    out.push('')
  }
} else {
  // Only internal commits (chore/ci/docs/test). Be honest about it.
  out.push('Maintenance release. No user-facing changes this build.', '')
}

out.push('## What\'s Changed', '')
if (commits.length) {
  for (const c of commits) out.push(`- ${c.subject} (${c.hash})`)
} else {
  out.push('- No changes since the previous release.')
}
out.push('')
out.push(`**Full Changelog**: https://github.com/${repo}/compare/${prevTag || 'v0.0.0'}...v${version}`)

process.stdout.write(out.join('\n') + '\n')
