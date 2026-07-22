/**
 * Regression guard for the observation-summary CONFABULATION bug: a small/quantized
 * local model copied the prompt's few-shot example verbatim ("Praveen: it won't be
 * easy…") onto unrelated frames (e.g. an Xcode error screen). The fix removed the
 * copyable, real-name example and replaced it with un-copyable templates. This test
 * fails if those literal examples ever creep back into the extract prompt.
 */
import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

// This guards a prompt that lives in the PRIVATE pro repo. In a core-only checkout
// (open-core: pro/ is gitignored/absent) the file doesn't exist — skip rather than
// crash the whole vitest run at collection time.
const EXTRACT = path.resolve(process.cwd(), 'pro/main/crm/extract.ts')
const SRC = fs.existsSync(EXTRACT) ? fs.readFileSync(EXTRACT, 'utf-8') : ''

describe.skipIf(!SRC)('extract prompt — no copyable few-shot examples', () => {
  it('does not embed the verbatim quote a weak model copied', () => {
    expect(SRC).not.toMatch(/it won't be easy, but it's alright/i)
  })

  it('does not embed a real person name as an example/placeholder', () => {
    expect(SRC).not.toMatch(/Praveen/)
    expect(SRC).not.toMatch(/Udayan Adhye/)
  })

  it('keeps the grounding instruction and uses un-copyable templates', () => {
    expect(SRC).toMatch(/grounded only in the text/i)
    expect(SRC).toMatch(/<person/i) // template placeholder, not a real name
    expect(SRC).toMatch(/never output the words/i)
  })
})
