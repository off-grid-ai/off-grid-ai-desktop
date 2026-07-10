import { defineConfig } from 'eslint/config'
import tseslint from '@electron-toolkit/eslint-config-ts'
import eslintConfigPrettier from '@electron-toolkit/eslint-config-prettier'
import eslintPluginReact from 'eslint-plugin-react'
import eslintPluginReactHooks from 'eslint-plugin-react-hooks'
import eslintPluginReactRefresh from 'eslint-plugin-react-refresh'
import sonarjs from 'eslint-plugin-sonarjs'
import tsESLint from 'typescript-eslint'

// Typed dead-BRANCH gate: no-unnecessary-condition uses the type-checker to flag
// conditions that are always truthy/falsy given the types — the exact AI pattern
// (defensive `if (x && x.y)` after x is already non-null, dead `===` branches,
// `x?.y` where x can't be null). Requires typed linting (projectService). WARN
// ratchet — many are genuine dead branches to delete, but some are legit guards at
// untyped boundaries (JSON.parse / IPC / external data) where the fix is to correct
// the TYPE, not delete the guard — so it's a triage signal, never auto-fixed.
// Scoped to the dirs the tsconfigs cover so projectService never errors on a stray file.
const typedDeadBranchWarn = {
  name: 'typed no-unnecessary-condition (warn ratchet)',
  files: [
    'src/main/**/*.ts',
    'src/preload/**/*.ts',
    'src/renderer/src/**/*.{ts,tsx}',
    'pro/main/**/*.ts',
    'pro/renderer/**/*.{ts,tsx}'
  ],
  ignores: ['**/*.{test,spec,dbtest}.{ts,tsx}', '**/__tests__/**', '**/*.d.ts'],
  languageOptions: {
    parser: tsESLint.parser,
    parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname }
  },
  plugins: { '@typescript-eslint': tsESLint.plugin },
  rules: { '@typescript-eslint/no-unnecessary-condition': 'warn' }
}

// Sonar-grade rules (bugs, cognitive complexity, duplicated branches, dead code)
// scoped to pro/** ONLY. Core src is covered by SonarCloud Automatic Analysis, so
// running sonarjs there too would be redundant — but SonarCloud (public project)
// never sees the private pro submodule, so this is how pro gets the same class of
// checks. pro has no own toolchain; it's linted by this root config. Introduced at
// WARN (ratchet, per CLAUDE.md "Pending hygiene adoption") with sonarjs's purely-
// stylistic / already-owned rules turned off so what's left is real defect signal.
const sonarProWarn = {
  ...sonarjs.configs.recommended,
  name: 'sonarjs on pro (warn ratchet)',
  // Product code only — test files are intentionally explicit/repetitive; linting
  // them for duplicate-string / complexity is noise (SonarCloud separates test from
  // main sources for the same reason). Not suppression — correct scoping.
  files: ['pro/**/*.{ts,tsx}'],
  ignores: ['pro/**/*.{test,spec}.{ts,tsx}', 'pro/**/__tests__/**'],
  rules: {
    ...Object.fromEntries(Object.keys(sonarjs.configs.recommended.rules ?? {}).map((rule) => [rule, 'warn'])),
    // Pure style — not a defect:
    'sonarjs/arrow-function-convention': 'off',
    'sonarjs/file-header': 'off',
    'sonarjs/shorthand-property-grouping': 'off',
    'sonarjs/no-wildcard-import': 'off', // `import * as fs/http/path` is intentional here
    'sonarjs/void-use': 'off', // `void promise` is our intentional fire-and-forget idiom
    // Owned by another gate / genuine false positives on this codebase:
    'sonarjs/no-implicit-dependencies': 'off', // dependency-cruiser owns dep boundaries
    'sonarjs/no-reference-error': 'off', // type-unaware; fires on the valid `NodeJS.Timeout` type — tsc is the real ref-error gate
    'sonarjs/publicly-writable-directories': 'off' // os.tmpdir() scratch files are legitimate
  }
}

export default defineConfig(
  { ignores: ['**/node_modules', '**/dist', '**/out'] },
  tseslint.configs.recommended,
  eslintPluginReact.configs.flat.recommended,
  eslintPluginReact.configs.flat['jsx-runtime'],
  sonarProWarn,
  typedDeadBranchWarn,
  {
    settings: {
      react: {
        version: 'detect'
      }
    }
  },
  {
    files: ['**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': eslintPluginReactHooks,
      'react-refresh': eslintPluginReactRefresh
    },
    rules: {
      ...eslintPluginReactHooks.configs.recommended.rules,
      ...eslintPluginReactRefresh.configs.vite.rules
    }
  },
  eslintConfigPrettier
)
