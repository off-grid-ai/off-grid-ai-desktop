/**
 * Guard for chat -> linked-project navigation. When a chat is scoped to a project,
 * the header shows a clickable indicator that opens that project. MemoryChat.tsx is
 * coverage-excluded, so guard the contract by reading the source (§D).
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

const src = readFileSync(join(__dirname, '../MemoryChat.tsx'), 'utf8')

describe('chat header — linked project is shown and navigable', () => {
  it('accepts an onOpenProject navigation callback', () => {
    expect(src).toMatch(/onOpenProject\?: \(projectId: string\) => void/)
  })

  it('renders a clickable project indicator that calls onOpenProject with the active project', () => {
    expect(src).toMatch(/activeProjectId && activeProjectName/)
    expect(src).toMatch(/onOpenProject\?\.\(activeProjectId\)/)
  })
})
