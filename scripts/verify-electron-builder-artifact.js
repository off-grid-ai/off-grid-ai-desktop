const path = require('node:path')

exports.default = async function verifyElectronBuilderArtifact(event) {
  if (!event.file.toLowerCase().endsWith('.dmg')) return

  const { verifyDmgArtifact } = await import('./lib/macos-artifact-integrity.mjs')
  const appOutDir = event.packager.computeAppOutDir(event.target.outDir, event.arch)
  const referenceBundle = path.join(appOutDir, `${event.packager.appInfo.productFilename}.app`)

  console.log(`[artifact-integrity] verifying ${path.basename(event.file)} before publish`)
  await verifyDmgArtifact(event.file, referenceBundle)
  console.log('[artifact-integrity] DMG bundle matches signed packaged app')
}
