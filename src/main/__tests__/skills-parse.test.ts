import { describe, it, expect } from 'vitest'
import { parseSkill, parseTrigger, slugify } from '../skills-parse'

describe('parseSkill', () => {
  it('parses a full skill with frontmatter + body', () => {
    const md = `---
name: proofread
description: Fix grammar and clarity.
---
You are a careful proofreader.`
    const s = parseSkill(md, 'fallback')
    expect(s.name).toBe('proofread')
    expect(s.description).toBe('Fix grammar and clarity.')
    expect(s.instructions).toBe('You are a careful proofreader.')
    expect(s.trigger).toBeUndefined()
  })

  it('parses a minimal frontmatter (name only) and trims body', () => {
    const md = `---
name: minimal
---
  do the thing
`
    const s = parseSkill(md, 'fallback')
    expect(s.name).toBe('minimal')
    expect(s.description).toBe('')
    expect(s.instructions).toBe('do the thing')
  })

  it('falls back to fallbackName + whole input as body when no frontmatter', () => {
    const s = parseSkill('just some instructions', 'myname')
    expect(s.name).toBe('myname')
    expect(s.description).toBe('')
    expect(s.instructions).toBe('just some instructions')
  })

  it('strips surrounding quotes from frontmatter values', () => {
    const md = `---
name: "quoted"
description: 'single'
---
body`
    const s = parseSkill(md, 'fallback')
    expect(s.name).toBe('quoted')
    expect(s.description).toBe('single')
  })

  it('attaches a parsed trigger + action + connectors when present', () => {
    const md = `---
name: daily
description: morning brief
trigger: schedule
trigger_config: 09:30
action: summarize my day
connectors: false
---
instructions here`
    const s = parseSkill(md, 'fallback')
    expect(s.trigger).toEqual({ kind: 'schedule', at: '09:30' })
    expect(s.action).toBe('summarize my day')
    expect(s.connectors).toBe(false)
  })

  it('omits action/connectors when there is no trigger', () => {
    const md = `---
name: x
action: ignored without trigger
---
b`
    const s = parseSkill(md, 'fallback')
    expect(s.trigger).toBeUndefined()
    expect(s.action).toBeUndefined()
    expect(s.connectors).toBeUndefined()
  })
})

describe('parseTrigger', () => {
  it('schedule: keeps a valid HH:MM', () => {
    expect(parseTrigger('schedule', '07:15')).toEqual({ kind: 'schedule', at: '07:15' })
  })

  it('schedule: defaults to 08:00 for a malformed time', () => {
    expect(parseTrigger('schedule', 'noon')).toEqual({ kind: 'schedule', at: '08:00' })
  })

  it('keyword: splits a CSV list, trimming and dropping blanks', () => {
    expect(parseTrigger('keyword', 'invoice, , receipt ')).toEqual({
      kind: 'keyword',
      keywords: ['invoice', 'receipt']
    })
  })

  it('keyword: returns undefined when the list is empty', () => {
    expect(parseTrigger('keyword', '  ,  ')).toBeUndefined()
  })

  it('event: recognizes approval, else defaults to calendar', () => {
    expect(parseTrigger('event', 'approval')).toEqual({ kind: 'event', on: 'approval' })
    expect(parseTrigger('event', 'anything else')).toEqual({ kind: 'event', on: 'calendar' })
  })

  it('unknown kind → undefined', () => {
    expect(parseTrigger('bogus', 'x')).toBeUndefined()
  })
})

describe('slugify', () => {
  it('lowercases and replaces spaces with hyphens', () => {
    expect(slugify('My Cool Skill')).toBe('my-cool-skill')
  })

  it('collapses runs of unsafe chars into a single hyphen and trims edges', () => {
    expect(slugify('  Hello!!!  World???  ')).toBe('hello-world')
  })

  it('caps the slug at 60 chars', () => {
    expect(slugify('a'.repeat(100)).length).toBe(60)
  })

  it('returns "skill" for empty / all-unsafe input', () => {
    expect(slugify('')).toBe('skill')
    expect(slugify('!!!')).toBe('skill')
  })
})
