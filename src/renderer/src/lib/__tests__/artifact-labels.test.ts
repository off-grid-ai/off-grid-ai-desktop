import { describe, it, expect } from 'vitest'
import { ARTIFACT_KIND_LABELS, artifactKindLabel } from '../artifact-labels'

describe('ARTIFACT_KIND_LABELS — the shared artifact badge labels', () => {
  it('carries the exact short badge label for every artifact kind', () => {
    expect(ARTIFACT_KIND_LABELS).toEqual({
      html: 'HTML',
      svg: 'SVG',
      mermaid: 'Diagram',
      react: 'React',
      text: 'Document',
      image: 'Image'
    })
  })

  it('artifactKindLabel returns the badge for a known kind', () => {
    expect(artifactKindLabel('html')).toBe('HTML')
    expect(artifactKindLabel('mermaid')).toBe('Diagram')
    expect(artifactKindLabel('text')).toBe('Document')
  })

  it('artifactKindLabel falls back to the raw kind for an unknown value', () => {
    expect(artifactKindLabel('pdf')).toBe('pdf')
    expect(artifactKindLabel('')).toBe('')
  })
})
