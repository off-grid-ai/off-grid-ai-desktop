import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const sourceChecklistPath = path.join(repositoryRoot, 'docs/RELEASE_TEST_CHECKLIST.csv')
const coverageLedgerPath = path.join(repositoryRoot, 'docs/P0_P2_INTEGRATION_COVERAGE.md')
const supplementalPath = path.join(
  repositoryRoot,
  'docs/release-readiness-supplemental-0.0.40.json'
)
const outputPath = path.join(repositoryRoot, 'docs/RELEASE_READINESS_CHECKLIST_0.0.40.csv')

function parseCsv(text) {
  const rows = []
  let row = []
  let field = ''
  let quoted = false

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]
    if (character === '"') {
      if (quoted && text[index + 1] === '"') {
        field += '"'
        index += 1
      } else {
        quoted = !quoted
      }
    } else if (character === ',' && !quoted) {
      row.push(field)
      field = ''
    } else if ((character === '\n' || character === '\r') && !quoted) {
      if (character === '\r' && text[index + 1] === '\n') index += 1
      row.push(field)
      if (row.some((value) => value.length > 0)) rows.push(row)
      row = []
      field = ''
    } else {
      field += character
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows
}

function csvField(value) {
  const normalized = String(value ?? '')
    .replaceAll('\r\n', '\n')
    .replaceAll('\r', '\n')
  return /[",\n]/.test(normalized) ? `"${normalized.replaceAll('"', '""')}"` : normalized
}

function serializeCsv(rows) {
  return `${rows.map((row) => row.map(csvField).join(',')).join('\n')}\n`
}

function ids(block) {
  return [...block.matchAll(/#(\d+)/g)].map((match) => Number(match[1]))
}

function strictClassifications(ledger) {
  const strict =
    ledger.match(/## Strict status[^\n]*\n([\s\S]*?)\n## Prior evidence inventory/)?.[1] ?? ''
  const block = (label, nextLabel) =>
    strict.match(new RegExp(`^- ${label}:\\n([\\s\\S]*?)(?=^- ${nextLabel}:)`, 'm'))?.[1] ?? ''
  const result = new Map()

  for (const id of [
    ...ids(block('Complete P0 journeys', 'Complete P1 journeys')),
    ...ids(block('Complete P1 journeys', 'Complete P2 journeys')),
    ...ids(block('Complete P2 journeys', 'Partial P0 journeys left'))
  ]) {
    result.set(id, 'COMPLETE')
  }
  for (const id of [
    ...ids(block('Partial P0 journeys left', 'Partial P1 journeys left')),
    ...ids(block('Partial P1 journeys left', 'Partial P2 journeys left')),
    ...ids(block('Partial P2 journeys left', 'Open journeys'))
  ]) {
    result.set(id, 'PARTIAL')
  }
  for (const id of ids(block('Open journeys', 'Corrective note'))) result.set(id, 'OPEN')
  return result
}

function evidenceByJourney(ledger) {
  const evidence = new Map()
  let activeId
  let lines = []

  const finish = () => {
    if (!activeId) return
    evidence.set(activeId, lines.join(' ').replace(/\s+/g, ' ').trim())
  }

  for (const line of ledger.split(/\r?\n/)) {
    const start = line.match(/^- #(\d+) - (.*)$/)
    if (start) {
      finish()
      activeId = Number(start[1])
      lines = [start[2]]
    } else if (activeId && /^  /.test(line)) {
      lines.push(line.trim())
    } else if (activeId && (line.startsWith('## ') || line.startsWith('- #'))) {
      finish()
      activeId = undefined
      lines = []
    }
  }
  finish()
  return evidence
}

function tierFor(row) {
  const id = Number(row[0])
  const notes = row[8] ?? ''
  if (/Core artifact only/i.test(notes) || id === 1) return 'Core'
  if (/Pro (artifact|only)/i.test(notes) || (id >= 83 && id <= 104) || (id >= 107 && id <= 128)) {
    return 'Pro'
  }
  return 'Both'
}

function automationType(evidence, status) {
  if (status === 'OPEN') return 'None complete'
  const types = []
  if (/\be2e\//i.test(evidence) || /Electron (tour|journey)/i.test(evidence)) types.push('E2E')
  if (/integration|dbtest|real SQLite|real HTTP|real KDBX/i.test(evidence))
    types.push('Integration')
  if (/source|contract|guard|script|workflow|packag/i.test(evidence))
    types.push('Contract/package gate')
  return types.length > 0 ? [...new Set(types)].join(' + ') : 'Automated test'
}

function testEvidence(evidence) {
  const quoted = [...evidence.matchAll(/`([^`]+)`/g)].map((match) => match[1])
  const files = quoted.filter((value) =>
    /(?:\.test\.|\.spec\.|\.dbtest\.|\.integration\.|\.mjs$|\.sh$)/i.test(value)
  )
  return [...new Set(files)].join('; ')
}

const nativeRisk =
  /DMG|package|install|upgrade|permission|microphone|speaker|audio|hotkey|cursor|clipboard|system browser|OAuth|connector|network|offline|update|disk|multi-monitor|screen capture|notification|license|entitlement|external/i

function confidenceFor(status, title) {
  if (status === 'OPEN') return 'LOW'
  if (status === 'COMPLETE') return nativeRisk.test(title) ? 'MEDIUM' : 'HIGH'
  return nativeRisk.test(title) ? 'LOW' : 'MEDIUM'
}

function confidenceReason(status, confidence) {
  if (status === 'OPEN') {
    return 'The final signed/notarized production-artifact journey is not covered end to end.'
  }
  if (status === 'COMPLETE' && confidence === 'HIGH') {
    return 'The strict ledger confirms the decisive production collaborators run through the real application seam.'
  }
  if (status === 'COMPLETE') {
    return 'The production seam is automated, but the exact installed macOS, hardware, permission, or external-system boundary still needs device evidence.'
  }
  if (confidence === 'LOW') {
    return 'Useful automation exists, but it does not prove the decisive installed, native, hardware, network, or external-system boundary.'
  }
  return 'Useful real integration exists, but at least one rendered, persistence, runtime, or full-journey seam is still substituted or separate.'
}

function remainingBoundary(status, row, evidence) {
  const title = row[2]
  if (status === 'OPEN') {
    return `Run the complete ${title} journey against the exact Developer ID-signed, notarized, stapled 0.0.40 artifact.`
  }
  const explicitGap = evidence.match(
    /((?:[^.]*)(?:remains (?:a )?(?:separate|manual)|not yet|still (?:substitutes|replaces)|only .* (?:faked|controlled))[^.]*\.)/i
  )?.[1]
  if (explicitGap) return explicitGap.trim()
  if (nativeRisk.test(title)) {
    return 'Repeat the listed steps on the exact installed 0.0.40 artifact with the real macOS, hardware, network, or external-system boundary.'
  }
  return 'Run the listed visible journey on the exact installed 0.0.40 artifact and inspect state, persistence, errors, and pixels.'
}

const sourceRows = parseCsv(fs.readFileSync(sourceChecklistPath, 'utf8'))
const sourceHeader = sourceRows.shift()
const ledger = fs.readFileSync(coverageLedgerPath, 'utf8')
const classifications = strictClassifications(ledger)
const evidence = evidenceByJourney(ledger)
const supplementalRows = JSON.parse(fs.readFileSync(supplementalPath, 'utf8'))

const outputHeader = [
  'Release',
  'Journey ID',
  'Phase',
  'Tier',
  'Priority',
  'Manual test',
  'Exact manual steps',
  'Expected result',
  'Automated test exists',
  'Strict automation status',
  'Automation layer',
  'Automated test evidence',
  'What automation proves',
  'What remains manual',
  'Regression confidence',
  'Confidence rationale',
  'Manual result',
  'Tester',
  'Run date',
  'Evidence path or URL',
  'Defect link',
  'Release notes'
]

const outputRows = sourceRows.map((row) => {
  const id = Number(row[0])
  const status = classifications.get(id)
  if (!status) throw new Error(`Journey ${id} has no strict automation classification`)
  const proof = evidence.get(id) ?? ''
  const confidence = confidenceFor(status, row[2])
  return [
    '0.0.40',
    id,
    row[1],
    tierFor(row),
    row[5],
    row[2],
    row[3],
    row[4],
    status === 'OPEN' ? 'No' : 'Yes',
    status,
    automationType(proof, status),
    testEvidence(proof),
    proof || 'No automated release-journey evidence is recorded.',
    remainingBoundary(status, row, proof),
    confidence,
    confidenceReason(status, confidence),
    'NOT RUN',
    '',
    '',
    '',
    '',
    row[8] ?? ''
  ]
})

for (const row of supplementalRows) {
  outputRows.push([
    '0.0.40',
    row.id,
    row.phase,
    row.tier,
    row.priority,
    row.manualTest,
    row.steps,
    row.expected,
    row.status === 'OPEN' ? 'No' : 'Yes',
    row.status,
    row.layer,
    row.evidence,
    row.proof,
    row.remaining,
    row.confidence,
    confidenceReason(row.status, row.confidence),
    'NOT RUN',
    '',
    '',
    '',
    '',
    row.notes
  ])
}

if (sourceHeader?.[0] !== '#' || sourceRows.length !== 155) {
  throw new Error(`Expected the canonical 155-journey checklist, received ${sourceRows.length}`)
}

const uniqueIds = new Set(outputRows.map((row) => String(row[1])))
if (uniqueIds.size !== outputRows.length)
  throw new Error('Release-readiness journey IDs must be unique')

fs.writeFileSync(outputPath, serializeCsv([outputHeader, ...outputRows]))
console.log(
  `Wrote ${outputRows.length} release journeys to ${path.relative(repositoryRoot, outputPath)}`
)
