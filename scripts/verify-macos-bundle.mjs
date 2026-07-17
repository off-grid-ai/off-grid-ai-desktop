#!/usr/bin/env node

import { verifyBundlePair } from './lib/macos-artifact-integrity.mjs'

const [referenceBundle, candidateBundle] = process.argv.slice(2)

if (!referenceBundle || !candidateBundle) {
  console.error('usage: verify-macos-bundle.mjs <packaged.app> <candidate.app>')
  process.exit(2)
}

try {
  verifyBundlePair(referenceBundle, candidateBundle)
  console.log('[bundle-integrity] candidate matches packaged app bundle')
} catch (error) {
  console.error(`[bundle-integrity] ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
}
