type EntityIdentifierKind = 'name' | 'email' | 'handle' | 'phone' | 'url'

interface EntityIdentifier {
  kind: EntityIdentifierKind
  value: string
}

export interface EntityCandidate {
  name: string
  type?: string
  identifiers?: EntityIdentifier[]
  partOf?: string
}

export interface EntityAdmissionContext {
  /** Canonical name, email, handles, and other aliases that identify the user. */
  selfAliases?: readonly string[]
}

export type EntityAdmissionRejection =
  | 'empty-name'
  | 'too-short'
  | 'self'
  | 'generic'
  | 'file'
  | 'path-or-repository'
  | 'domain'
  | 'code-symbol'

export type EntityAdmissionDecision =
  | { admitted: true; candidate: EntityCandidate }
  | { admitted: false; reason: EntityAdmissionRejection }

const GENERIC_NAMES = new Set([
  'admin',
  'api',
  'app',
  'backend',
  'bug',
  'client',
  'cli',
  'code',
  'css',
  'data',
  'database',
  'dev',
  'file',
  'frontend',
  'html',
  'http',
  'ide',
  'json',
  'prod',
  'server',
  'sql',
  'staging',
  'test',
  'ui',
  'url',
  'user',
  'ux',
  'web',
  'website',
  'xml',
  'yaml'
])

const FILE_EXTENSION =
  /\.(ts|tsx|js|jsx|mjs|cjs|py|rs|go|java|rb|c|cpp|h|swift|kt|sh|bat|ps1|png|jpe?g|webp|gif|svg|ico|pptx?|docx?|xlsx?|pdf|apk|ipa|json|ya?ml|toml|lock|html?|css|scss|md|markdown|txt|csv|sql|env)$/i
const DOCUMENT_SUFFIX = /\b(md|pdf|docx?|xlsx?|pptx?|csv)$/i
const DOMAIN = /\.(com|dev|de|net|io|co|online|app|ai|org|gov|in|xyz)$/i
const CODE_SYMBOL = /^[a-z][a-zA-Z0-9]*[A-Z][a-zA-Z0-9]*$/
const CODE_SUFFIX =
  /(Store|Engine|Bridge|Sheet|Picker|Toggle|Handler|Provider|Context|Wrapper|Schema|Config|Screen|Tab|Modal|Service|Controller|Component|Sink)$/
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)+$/

const POLLUTION_RULES: ReadonlyArray<{
  reason: Exclude<EntityAdmissionRejection, 'empty-name' | 'too-short' | 'self'>
  matches: (name: string) => boolean
}> = [
  { reason: 'generic', matches: (name) => GENERIC_NAMES.has(name.toLocaleLowerCase()) },
  { reason: 'file', matches: (name) => FILE_EXTENSION.test(name) || DOCUMENT_SUFFIX.test(name) },
  {
    reason: 'path-or-repository',
    matches: (name) => name.includes('/') || name.includes('\\') || name.includes('#')
  },
  { reason: 'domain', matches: (name) => DOMAIN.test(name) || /googleapis|atlassian/i.test(name) },
  {
    reason: 'code-symbol',
    matches: (name) => CODE_SYMBOL.test(name) || CODE_SUFFIX.test(name) || SLUG.test(name)
  }
]

function normalizeText(value: string): string {
  return value.normalize('NFKC').replace(/\s+/g, ' ').trim()
}

function identityKey(value: string): string {
  return normalizeText(value).toLocaleLowerCase()
}

function normalizeCandidate(candidate: EntityCandidate): EntityCandidate {
  const identifiers = (candidate.identifiers ?? [])
    .map((identifier) => ({
      kind: identifier.kind,
      value: normalizeText(identifier.value)
    }))
    .filter((identifier) => identifier.value.length > 0)

  return {
    name: normalizeText(candidate.name || ''),
    type: normalizeText(candidate.type || '') || 'Unknown',
    ...(identifiers.length > 0 ? { identifiers } : {}),
    ...(candidate.partOf && normalizeText(candidate.partOf)
      ? { partOf: normalizeText(candidate.partOf) }
      : {})
  }
}

/**
 * Pure admission policy for every entity candidate, regardless of its producer.
 * Extractors are untrusted callers: normalization and pollution rejection happen
 * here, immediately before the domain implementation may persist the candidate.
 */
export function assessEntityCandidate(
  candidate: EntityCandidate,
  context: EntityAdmissionContext = {}
): EntityAdmissionDecision {
  const normalized = normalizeCandidate(candidate)
  const name = normalized.name
  if (!name) return { admitted: false, reason: 'empty-name' }
  if (name.length < 3) return { admitted: false, reason: 'too-short' }

  const self = new Set((context.selfAliases ?? []).map(identityKey).filter(Boolean))
  const candidateKeys = [
    name,
    ...(normalized.identifiers ?? []).map((identifier) => identifier.value)
  ]
  if (candidateKeys.some((value) => self.has(identityKey(value)))) {
    return { admitted: false, reason: 'self' }
  }

  const pollution = POLLUTION_RULES.find((rule) => rule.matches(name))
  if (pollution) return { admitted: false, reason: pollution.reason }

  return { admitted: true, candidate: normalized }
}
