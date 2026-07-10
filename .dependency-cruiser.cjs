// Architecture-boundary gate (hygiene §A separation-of-concerns + §H open-core).
// dependency-cruiser walks the IMPORT GRAPH and fails the build on a forbidden edge.
// It is the mechanical enforcement for the two rules that were previously guarded
// only by review: core-never-imports-pro, and the extracted pure-logic siblings
// staying zero-IO. (Duplication / smells / coverage are SonarCloud's job — a
// different axis; this tool sees edges, not code content.)
//
// Run: `npm run depcruise`. All rules below are verified clean against the current
// tree (534 modules, 0 violations) so this is a true blocking gate that passes today.
module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      comment: 'Circular imports make load order fragile and break tree-shaking. Restructure so the shared piece is its own module.',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
    {
      name: 'open-core-boundary',
      comment:
        'Open core (§H): core (public, AGPL) must NEVER import pro source. Only the loader seams ' +
        '(loadProFeaturesMain/Renderer + main.tsx, which resolve the alias to the free-build stub) ' +
        'may cross the pro boundary. A stray core->pro import ships paid source in the public repo.',
      severity: 'error',
      from: { pathNot: '(loadProFeaturesMain|loadProFeaturesRenderer|main\\.tsx|bootstrap/proStub)' },
      to: { path: 'bootstrap/proStub\\.ts$|(^|/)pro/(main|renderer)/' },
    },
    {
      name: 'pure-stays-pure',
      comment:
        'Isolate pure logic from I/O (§A). The extracted decision modules are unit-tested BECAUSE ' +
        'they import no Electron/DB/network. An accidental IO import both breaks testability and ' +
        'silently grows the coverage-excluded shell while coverage still looks green.',
      severity: 'error',
      from: {
        path: 'src/main/(search-ranking|ipc-query-logic|model-sizing|files-classify|tts-logic|vectors-predicates|skills-parse|tools-parsers|mime|models/gguf)\\.ts$',
      },
      to: {
        path: '(^|/)node_modules/electron|src/main/(database|vectors|llm|mcp|embeddings|search)\\.ts$',
      },
    },
    {
      name: 'renderer-not-to-main',
      comment: 'The renderer talks to main ONLY through the preload IPC bridge, never by importing main modules directly.',
      severity: 'error',
      from: { path: '^src/renderer' },
      to: { path: '^src/main' },
    },
    {
      name: 'not-to-test',
      comment: 'Production code must not import test files (a test in the prod graph ships, and drags its fixtures in).',
      severity: 'error',
      from: { pathNot: '\\.(test|spec)\\.(ts|tsx)$|__tests__' },
      to: { path: '\\.(test|spec)\\.(ts|tsx)$|__tests__/' },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsConfig: { fileName: 'tsconfig.web.json' },
    exclude: { path: 'node_modules|e2e/' },
    tsPreCompilationDeps: true,
  },
};
