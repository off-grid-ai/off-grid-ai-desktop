const path = require('node:path')

exports.default = async function verifyElectronBuilderArtifact(event) {
  if (!event.file.toLowerCase().endsWith('.dmg')) return

  const { verifyDmgArtifact } = await import('./lib/macos-artifact-integrity.mjs')
  const appOutDir = event.packager.computeAppOutDir(event.target.outDir, event.arch)
  const referenceBundle = path.join(appOutDir, `${event.packager.appInfo.productFilename}.app`)
  const requireCodeSignature = process.env.OFFGRID_ALLOW_UNSIGNED_ARTIFACT !== '1'

  console.log(`[artifact-integrity] verifying ${path.basename(event.file)} before publish`)
  await verifyDmgArtifact(event.file, referenceBundle, { requireCodeSignature })
  console.log(
    requireCodeSignature
      ? '[artifact-integrity] DMG bundle matches signed packaged app'
      : '[artifact-integrity] DMG bundle matches packaged app (local unsigned build)'
  )
}
