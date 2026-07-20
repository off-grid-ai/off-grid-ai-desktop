import { resolve } from 'node:path'
import { existsSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { createRendererContentSecurityPolicy } from './src/shared/renderer-csp'

// Open-core seam: the private `pro/` git submodule is present only in paid
// builds. When it's missing (free / contributor build) we alias the pro entry
// points to a null stub so the app builds and runs with core features only.
// Mirrors mobile/metro.config.js (proExists + extraNodeModules).
// OFFGRID_FORCE_CORE=1 builds the free/core artifact even when the pro/ submodule
// is checked out — lets CI (and local) produce BOTH core and pro DMGs from one
// checkout without removing the submodule.
const forceCore = process.env.OFFGRID_FORCE_CORE === '1'
const proExists = !forceCore && existsSync(resolve('pro/package.json'))
const stub = resolve('src/bootstrap/proStub.ts')
const proMain = proExists ? resolve('pro/main/index.ts') : stub
const proRenderer = proExists ? resolve('pro/renderer/index.tsx') : stub

// Baked into every bundle so runtime code can tell a pro build from a free build
// without relying on an env var default (which can't distinguish "unset" from "pro").
const proDefine = { __OFFGRID_PRO__: JSON.stringify(proExists) }
const rendererStyleNonce = randomBytes(18).toString('base64url')
const rendererContentSecurityPolicy = createRendererContentSecurityPolicy(rendererStyleNonce)

export default defineConfig({
  main: {
    define: proDefine,
    build: {
      rollupOptions: {
        // The TTS worker must live inside app.asar beside its JavaScript
        // dependencies. Copying the raw source into Resources makes ESM resolve
        // from that external directory, where kokoro-js does not exist.
        input: {
          index: resolve('src/main/index.ts'),
          'tts-worker': resolve('resources/tts-worker.mjs')
        }
      }
    },
    // Deps are externalized by default (resolved from node_modules at runtime).
    // @scure/bip39 + @noble/hashes are ESM-only ("type":"module"); a CJS main
    // process require()-ing them throws ERR_REQUIRE_ESM at runtime. Exclude them
    // from externalization so Rollup BUNDLES them into the main chunk (transpiled
    // to the output format), sidestepping the ESM/CJS boundary. Used by the pro
    // vault recovery-phrase feature (pro/main/vault/vault-recovery.ts).
    plugins: [externalizeDepsPlugin({ exclude: ['@scure/bip39', '@noble/hashes'] })],
    resolve: {
      alias: {
        '@offgrid/core': resolve('src'),
        '@offgrid/pro/main': proMain
      }
    }
  },
  preload: {
    define: proDefine
  },
  renderer: {
    define: proDefine,
    html: { cspNonce: rendererStyleNonce },
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        '@': resolve('src/renderer/src'),
        '@offgrid/core': resolve('src'),
        '@offgrid/pro/renderer': proRenderer
      }
    },
    plugins: [
      {
        name: 'offgrid-renderer-csp',
        transformIndexHtml: {
          order: 'pre',
          handler: () => [
            {
              tag: 'meta',
              attrs: {
                'http-equiv': 'Content-Security-Policy',
                content: rendererContentSecurityPolicy
              },
              injectTo: 'head-prepend'
            }
          ]
        }
      },
      react(),
      tailwindcss()
    ]
  }
})
