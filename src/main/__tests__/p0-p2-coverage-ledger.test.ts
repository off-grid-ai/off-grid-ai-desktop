import { describe, expect, it } from 'vitest'
import fs from 'fs'
import path from 'path'

const checklistPath = path.join(process.cwd(), 'docs/RELEASE_TEST_CHECKLIST.csv')
const ledgerPath = path.join(process.cwd(), 'docs/P0_P2_INTEGRATION_COVERAGE.md')

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
const coveredBlocks = {
  P0: ledger.match(/## Covered P0 journeys\n([\s\S]*?)\n## Covered P1 journeys/)?.[1] ?? '',
  P1: ledger.match(/## Covered P1 journeys\n([\s\S]*?)\n## Covered P2 journeys/)?.[1] ?? '',
  P2: ledger.match(/## Covered P2 journeys\n([\s\S]*?)\n## Left/)?.[1] ?? ''
}
const leftBlock = ledger.match(/## Left[\s\S]*?(?=\n## Next implementation order)/)?.[0] ?? ''

describe('P0-P2 integration coverage ledger', () => {
  it('lists every checklist journey exactly once with one bullet per remaining item', () => {
    const covered = Object.values(coveredBlocks).flatMap(ids)
    const left = ids(leftBlock)
    const all = [...covered, ...left]
    const leftBullets = leftBlock.split(/\r?\n/).filter((line) => line.startsWith('- #'))

    expect(new Set(all).size).toBe(all.length)
    expect([...all].sort((a, b) => a - b)).toEqual([...priorityById.keys()].sort((a, b) => a - b))
    expect(leftBullets).toHaveLength(left.length)
  })

  it('keeps covered journeys under the priority declared by the CSV', () => {
    for (const [priority, block] of Object.entries(coveredBlocks)) {
      for (const id of ids(block)) expect(priorityById.get(id)).toBe(priority)
    }
  })

  it('keeps the status snapshot synchronized with the checklist and covered sections', () => {
    let coveredTotal = 0
    let checklistTotal = 0
    for (const priority of ['P0', 'P1', 'P2'] as const) {
      const total = [...priorityById.values()].filter((value) => value === priority).length
      const covered = ids(coveredBlocks[priority]).length
      const snapshot = ledger.match(
        new RegExp(`- ${priority}: (\\d+) total, (\\d+) covered, (\\d+) left\\.`)
      )
      expect(snapshot?.slice(1).map(Number)).toEqual([total, covered, total - covered])
      checklistTotal += total
      coveredTotal += covered
    }

    const overall = ledger.match(/- Overall: (\d+) total, (\d+) covered, (\d+) left\./)
    expect(overall?.slice(1).map(Number)).toEqual([
      checklistTotal,
      coveredTotal,
      checklistTotal - coveredTotal
    ])
  })
})
