import { defineConfig } from 'eslint/config'
import tseslint from '@electron-toolkit/eslint-config-ts'
import eslintConfigPrettier from '@electron-toolkit/eslint-config-prettier'
import eslintPluginReact from 'eslint-plugin-react'
import eslintPluginReactHooks from 'eslint-plugin-react-hooks'
import eslintPluginReactRefresh from 'eslint-plugin-react-refresh'
import sonarjs from 'eslint-plugin-sonarjs'

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
  files: ['pro/**/*.{ts,tsx}'],
  rules: {
    ...Object.fromEntries(Object.keys(sonarjs.configs.recommended.rules ?? {}).map((rule) => [rule, 'warn'])),
    'sonarjs/arrow-function-convention': 'off', // style, not a defect
    'sonarjs/file-header': 'off', // header policy
    'sonarjs/shorthand-property-grouping': 'off', // style
    'sonarjs/void-use': 'off', // `void promise` is our intentional fire-and-forget idiom
    'sonarjs/no-implicit-dependencies': 'off' // dependency-cruiser owns dep boundaries
  }
}

export default defineConfig(
  { ignores: ['**/node_modules', '**/dist', '**/out'] },
  tseslint.configs.recommended,
  eslintPluginReact.configs.flat.recommended,
  eslintPluginReact.configs.flat['jsx-runtime'],
  sonarProWarn,
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
