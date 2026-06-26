import { resolve } from 'path'
import { existsSync } from 'fs'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

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

export default defineConfig({
  main: {
    define: proDefine,
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
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        '@': resolve('src/renderer/src'),
        '@offgrid/core': resolve('src'),
        '@offgrid/pro/renderer': proRenderer
      }
    },
    plugins: [react(), tailwindcss()]
  }
})
