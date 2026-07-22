// Pure SQL-predicate builders extracted from vectors.ts so the string escaping /
// flooring can be unit-tested without opening a LanceDB connection. Behaviour is
// unchanged — vectors.ts imports these back for its delete queries.

/** Build the `kind IN (...)` predicate for a set of kinds, SQL-escaping single
 *  quotes (`'` -> `''`) in each value. */
export function kindsPredicate(kinds: string[]): string {
  const list = kinds.map((k) => `'${String(k).replace(/'/g, "''")}'`).join(', ')
  return `kind IN (${list})`
}

/** Append the age filter to a kinds predicate. `cutoffMs` is floored to an
 *  integer so a fractional epoch-ms never produces a malformed literal. */
export function olderThanPredicate(kinds: string[], cutoffMs: number): string {
  return `${kindsPredicate(kinds)} AND ts < ${Math.floor(cutoffMs)}`
}
