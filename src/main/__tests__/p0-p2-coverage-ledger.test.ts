import { describe, expect, it } from 'vitest'
import fs from 'fs'
import path from 'path'

const checklistPath = path.join(process.cwd(), 'docs/RELEASE_TEST_CHECKLIST.csv')
const ledgerPath = path.join(process.cwd(), 'docs/P0_P2_INTEGRATION_COVERAGE.md')
const releaseReadinessPath = path.join(process.cwd(), 'docs/RELEASE_READINESS_CHECKLIST_0.0.40.csv')
const supplementalPath = path.join(process.cwd(), 'docs/release-readiness-supplemental-0.0.40.json')

function parseCsvRow(row: string): string[] {
  const fields: string[] = []
  let field = ''
  let quoted = false
  for (let index = 0; index < row.length; index += 1) {
    const char = row[index]
    if (char === '"') {
      if (quoted && row[index + 1] === '"') {
        field += '"'
        index += 1
      } else {
        quoted = !quoted
      }
    } else if (char === ',' && !quoted) {
      fields.push(field)
      field = ''
    } else {
      field += char
    }
  }
  fields.push(field)
  return fields
}

function ids(block: string): number[] {
  return [...block.matchAll(/#(\d+)/g)].map((match) => Number(match[1]))
}

const checklistRows = fs
  .readFileSync(checklistPath, 'utf8')
  .trim()
  .split(/\r?\n/)
  .slice(1)
  .map(parseCsvRow)
const priorityById = new Map(checklistRows.map((row) => [Number(row[0]), row[5]]))
const ledger = fs.readFileSync(ledgerPath, 'utf8')
const strictLedger =
  ledger.match(/## Strict status[^\n]*\n([\s\S]*?)\n## Prior evidence inventory/)?.[1] ?? ''

function classificationBlock(label: string, nextLabel: string): string {
  return (
    strictLedger.match(new RegExp(`^- ${label}:\\n([\\s\\S]*?)(?=^- ${nextLabel}:)`, 'm'))?.[1] ??
    ''
  )
}

const classifications = {
  complete: {
    P0: classificationBlock('Complete P0 journeys', 'Complete P1 journeys'),
    P1: classificationBlock('Complete P1 journeys', 'Complete P2 journeys'),
    P2: classificationBlock('Complete P2 journeys', 'Partial P0 journeys left')
  },
  partial: {
    P0: classificationBlock('Partial P0 journeys left', 'Partial P1 journeys left'),
    P1: classificationBlock('Partial P1 journeys left', 'Partial P2 journeys left'),
    P2: classificationBlock('Partial P2 journeys left', 'Open journeys')
  },
  open: classificationBlock('Open journeys', 'Corrective note')
}

function snapshotCount(label: string): number | undefined {
  return Number(strictLedger.match(new RegExp(`^  - ${label}: (\\d+)(?: total)?\\.$`, 'm'))?.[1])
}

describe('P0-P2 integration coverage ledger', () => {
  it('classifies every checklist journey exactly once as complete, partial, or open', () => {
    const complete = Object.values(classifications.complete).flatMap(ids)
    const partial = Object.values(classifications.partial).flatMap(ids)
    const open = ids(classifications.open)
    const all = [...complete, ...partial, ...open]

    expect(new Set(all).size).toBe(all.length)
    expect([...all].sort((a, b) => a - b)).toEqual([...priorityById.keys()].sort((a, b) => a - b))
  })

  it('keeps complete and partial journeys under the priority declared by the CSV', () => {
    for (const status of ['complete', 'partial'] as const) {
      for (const [priority, block] of Object.entries(classifications[status])) {
        for (const id of ids(block)) expect(priorityById.get(id)).toBe(priority)
      }
    }
  })

  it('keeps the strict status snapshot synchronized with every classification', () => {
    const openIds = ids(classifications.open)
    const overall = { complete: 0, partial: 0, open: 0, left: 0 }
    let checklistTotal = 0

    for (const priority of ['P0', 'P1', 'P2'] as const) {
      const total = [...priorityById.values()].filter((value) => value === priority).length
      const complete = ids(classifications.complete[priority]).length
      const partial = ids(classifications.partial[priority]).length
      const open = openIds.filter((id) => priorityById.get(id) === priority).length
      const left = partial + open

      expect(snapshotCount(priority)).toBe(total)
      expect(snapshotCount(`${priority} complete`)).toBe(complete)
      expect(snapshotCount(`${priority} partial`)).toBe(partial)
      expect(snapshotCount(`${priority} open`)).toBe(open)
      expect(snapshotCount(`${priority} left`)).toBe(left)
      expect(complete + left).toBe(total)

      checklistTotal += total
      overall.complete += complete
      overall.partial += partial
      overall.open += open
      overall.left += left
    }

    expect(snapshotCount('Overall')).toBe(checklistTotal)
    expect(snapshotCount('Overall complete')).toBe(overall.complete)
    expect(snapshotCount('Overall partial')).toBe(overall.partial)
    expect(snapshotCount('Overall open')).toBe(overall.open)
    expect(snapshotCount('Overall left')).toBe(overall.left)
    expect(overall.complete + overall.left).toBe(checklistTotal)
  })

  it('publishes one actionable 0.0.40 release-readiness row for every journey', () => {
    const [header = [], ...rows] = fs
      .readFileSync(releaseReadinessPath, 'utf8')
      .trim()
      .split(/\r?\n/)
      .map(parseCsvRow)
    const column = (name: string) => header.indexOf(name)
    const requiredColumns = [
      'Journey ID',
      'Tier',
      'Automated test exists',
      'Strict automation status',
      'Automated test evidence',
      'What automation proves',
      'What remains manual',
      'Automation coverage %',
      'Manual verification %',
      'Release readiness %',
      'Remaining gap %',
      'Work state',
      'Gap-closing action',
      'Regression confidence',
      'Confidence rationale',
      'Manual result',
      'Evidence path or URL',
      'Defect link'
    ]

    for (const name of requiredColumns) expect(column(name)).toBeGreaterThanOrEqual(0)
    const supplemental = JSON.parse(fs.readFileSync(supplementalPath, 'utf8')) as Array<{
      id: string
    }>
    expect(rows).toHaveLength(checklistRows.length + supplemental.length)
    expect(
      rows.slice(0, checklistRows.length).map((row) => Number(row[column('Journey ID')]))
    ).toEqual(checklistRows.map((row) => Number(row[0])))
    expect(rows.slice(checklistRows.length).map((row) => row[column('Journey ID')])).toEqual(
      supplemental.map((row) => row.id)
    )
    expect(new Set(rows.map((row) => row[column('Journey ID')])).size).toBe(rows.length)

    const statusById = new Map<number, string>()
    for (const id of Object.values(classifications.complete).flatMap(ids)) {
      statusById.set(id, 'COMPLETE')
    }
    for (const id of Object.values(classifications.partial).flatMap(ids)) {
      statusById.set(id, 'PARTIAL')
    }
    for (const id of ids(classifications.open)) statusById.set(id, 'OPEN')

    for (const row of rows) {
      const id = Number(row[column('Journey ID')])
      const status = row[column('Strict automation status')]
      expect(['Core', 'Pro', 'Both']).toContain(row[column('Tier')])
      if (Number.isFinite(id)) expect(status).toBe(statusById.get(id))
      expect(row[column('Automated test exists')]).toBe(status === 'OPEN' ? 'No' : 'Yes')
      expect(row[column('What automation proves')]).not.toHaveLength(0)
      expect(row[column('What remains manual')]).not.toHaveLength(0)
      expect(Number(row[column('Automation coverage %')])).toBeGreaterThanOrEqual(0)
      expect(Number(row[column('Automation coverage %')])).toBeLessThanOrEqual(100)
      expect(row[column('Manual verification %')]).toMatch(/^=IF\(/)
      expect(row[column('Release readiness %')]).toMatch(/^=IF\(/)
      expect(row[column('Remaining gap %')]).toMatch(/^=100-/)
      expect(row[column('Work state')]).toMatch(/^=IF\(/)
      expect(row[column('Gap-closing action')]).not.toHaveLength(0)
      expect(['LOW', 'MEDIUM', 'HIGH']).toContain(row[column('Regression confidence')])
      expect(row[column('Confidence rationale')]).not.toHaveLength(0)
      expect(row[column('Manual result')]).toBe('NOT RUN')
    }
  })
})
