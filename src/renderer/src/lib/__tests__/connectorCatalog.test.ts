// Data-integrity tests for the connector catalog (components/connectorCatalog.ts).
// It is a pure data file that drives the "just hit Connect" gallery, so its
// structural invariants (unique ids, http entries have a url, token entries have
// secrets, every category is in the display order) are the contract the UI relies on.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  CONNECTOR_CATALOG,
  CATEGORY_ORDER,
  CONNECTOR_SETUP_HINTS,
  setupHintFor
} from '../../components/connectorCatalog'

describe('CONNECTOR_CATALOG', () => {
  it('is non-empty', () => {
    expect(CONNECTOR_CATALOG.length).toBeGreaterThan(0)
  })

  it('has unique connector ids', () => {
    const ids = CONNECTOR_CATALOG.map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('gives every entry the fields the card renders', () => {
    for (const c of CONNECTOR_CATALOG) {
      expect(c.id, 'id').toBeTruthy()
      expect(c.name, `name for ${c.id}`).toBeTruthy()
      expect(c.blurb, `blurb for ${c.id}`).toBeTruthy()
      expect(c.color, `color for ${c.id}`).toMatch(/^#[0-9A-Fa-f]{6}$/)
      expect(c.letter, `letter for ${c.id}`).toHaveLength(1)
      expect(typeof c.ready, `ready for ${c.id}`).toBe('boolean')
    }
  })

  it('every category used is in CATEGORY_ORDER', () => {
    const known = new Set<string>(CATEGORY_ORDER)
    for (const c of CONNECTOR_CATALOG) {
      expect(known.has(c.category), `unknown category "${c.category}" on ${c.id}`).toBe(true)
    }
  })

  it('CATEGORY_ORDER has no duplicates', () => {
    expect(new Set(CATEGORY_ORDER).size).toBe(CATEGORY_ORDER.length)
  })

  it('every http-transport entry has a url', () => {
    for (const c of CONNECTOR_CATALOG.filter((e) => e.transport === 'http')) {
      expect(c.url, `url for ${c.id}`).toBeTruthy()
    }
  })

  it('every stdio-transport entry has a command', () => {
    for (const c of CONNECTOR_CATALOG.filter((e) => e.transport === 'stdio')) {
      expect(c.command, `command for ${c.id}`).toBeTruthy()
    }
  })

  it('every token-auth entry lists at least one secret', () => {
    for (const c of CONNECTOR_CATALOG.filter((e) => e.auth === 'token')) {
      expect(c.secrets, `secrets for ${c.id}`).toBeDefined()
      expect(c.secrets!.length, `secrets for ${c.id}`).toBeGreaterThan(0)
      for (const s of c.secrets!) {
        expect(s.key, `secret key on ${c.id}`).toBeTruthy()
        expect(s.label, `secret label on ${c.id}`).toBeTruthy()
      }
    }
  })

  it('only uses the three known auth types', () => {
    const auths = new Set(CONNECTOR_CATALOG.map((c) => c.auth))
    for (const a of auths) {
      expect(['oauth', 'token', 'none']).toContain(a)
    }
  })

  // The Gmail + Google Calendar connectors are enabled (`ready: true`) so a user
  // can actually run the OAuth flow — a preview/`ready:false` entry renders
  // "disabled · preview" and blocks Connect. The token that flow stores is what
  // the REST-backed Calendar/Gmail ingest reads (pro/main/google-rest.ts), so
  // "ready" is the switch that turns the whole integration on for a user.
  it('Gmail and Google Calendar are connectable (ready) via their googleapis OAuth URLs', () => {
    for (const id of ['gmail', 'google-calendar']) {
      const c = CONNECTOR_CATALOG.find((e) => e.id === id)!
      expect(c, `${id} is in the catalog`).toBeTruthy()
      expect(c.ready, `${id} is connectable, not preview-gated`).toBe(true)
      expect(c.auth, `${id} authorizes over OAuth`).toBe('oauth')
      expect(c.url, `${id} points at a Google endpoint`).toContain('googleapis.com')
    }
  })
})

describe('CONNECTOR_SETUP_HINTS — catalog data, out of the view', () => {
  it('every hint id is a real catalog connector (no orphan hints)', () => {
    const ids = new Set(CONNECTOR_CATALOG.map((e) => e.id))
    for (const id of Object.keys(CONNECTOR_SETUP_HINTS)) {
      expect(ids.has(id)).toBe(true)
    }
  })

  it('setupHintFor returns the hint for a known id, undefined otherwise', () => {
    expect(setupHintFor('slack')).toMatch(/Bot User OAuth Token/)
    expect(setupHintFor('gmail')).toBeUndefined() // OAuth connector, no manual hint
    expect(setupHintFor('does-not-exist')).toBeUndefined()
  })

  it('the hints live in the catalog data module, not inlined in ConnectorsScreen', () => {
    const view = readFileSync(join(__dirname, '../../components/ConnectorsScreen.tsx'), 'utf8')
    expect(view).not.toMatch(/const SETUP_HINTS/)
    expect(view).toContain('setupHintFor')
  })
})
