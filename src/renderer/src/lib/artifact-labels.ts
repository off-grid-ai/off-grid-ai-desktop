// Single source of truth for the short artifact-kind BADGE label (the little
// uppercased chip: "HTML", "SVG", "Diagram", ...). It was defined identically in
// ArtifactCanvas and ProjectsScreen; a third, LONGER-form fallback title
// ("HTML page", "React component") lives in main/artifacts.ts labelFor and is a
// separate concern (a title fallback, not a badge) — deliberately NOT merged here.

export type ArtifactKind = 'html' | 'svg' | 'mermaid' | 'react' | 'text' | 'image';

/** The short badge label shown in the artifact chip. */
export const ARTIFACT_KIND_LABELS: Record<ArtifactKind, string> = {
  html: 'HTML',
  svg: 'SVG',
  mermaid: 'Diagram',
  react: 'React',
  text: 'Document',
  image: 'Image'
};

/** Badge label for a kind, falling back to the raw kind string for anything
 *  outside the known set. */
export function artifactKindLabel(kind: string): string {
  return (ARTIFACT_KIND_LABELS as Record<string, string>)[kind] ?? kind;
}
