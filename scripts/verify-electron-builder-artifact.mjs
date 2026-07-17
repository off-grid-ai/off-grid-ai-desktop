/* eslint-disable @typescript-eslint/explicit-function-return-type -- Electron-builder loads this hook directly as JavaScript. */
import path from 'node:path'
import { verifyDmgArtifact } from './lib/macos-artifact-integrity.mjs'

export default async function verifyElectronBuilderArtifact(event) {
  if (!event.file.toLowerCase().endsWith('.dmg')) return

  const appOutDir = event.packager.computeAppOutDir(event.target.outDir, event.arch)
  const referenceBundle = path.join(appOutDir, `${event.packager.appInfo.productFilename}.app`)

  console.log(`[artifact-integrity] verifying ${path.basename(event.file)} before publish`)
  await verifyDmgArtifact(event.file, referenceBundle)
  console.log('[artifact-integrity] DMG bundle matches signed packaged app')
}
