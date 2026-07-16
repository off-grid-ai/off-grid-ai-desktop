// Shared setup types, kept in a leaf module so the pure setup-logic and the IO
// shell (setup.ts) can both import RecMode without a circular dependency.

/** Resource-usage mode "Configure for me" picks for: light, default, or maximal. */
export type RecMode = 'conservative' | 'balanced' | 'extreme'
