/* eslint-disable @typescript-eslint/explicit-function-return-type -- Electron-builder loads this hook directly as JavaScript. */
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import {
  assertAsarArchiveInventory,
  verifyDmgArtifact,
  verifyReleaseDmgArtifact,
  verifyReleaseZipArtifact,
  verifyZipArtifact
} from './lib/macos-artifact-integrity.mjs'
import { releaseTeamIdForEnvironment } from './lib/macos-app-trust.mjs'

const execFileAsync = promisify(execFile)
const REPO_ROOT = path.resolve(import.meta.dirname, '..')

async function runInstalledDmgSmoke(dmgPath, referenceBundle) {
  const result = await execFileAsync(
    'bash',
    [path.join(REPO_ROOT, 'scripts', 'smoke-dmg-install.sh'), dmgPath],
    {
      env: { ...process.env, DMG_REFERENCE_APP: referenceBundle },
      timeout: 600_000,
      killSignal: 'SIGKILL',
      maxBuffer: 10 * 1024 * 1024
    }
  )
  if (result.stdout) process.stdout.write(result.stdout)
  if (result.stderr) process.stderr.write(result.stderr)
}

export default async function verifyElectronBuilderArtifact(event) {
  const artifact = event.file.toLowerCase()
  if (!artifact.endsWith('.dmg') && !artifact.endsWith('.zip') && !artifact.endsWith('.exe')) {
    return
  }

  const appOutDir = event.packager.computeAppOutDir(event.target.outDir, event.arch)
  if (artifact.endsWith('.exe')) {
    assertAsarArchiveInventory(path.join(appOutDir, 'resources', 'app.asar'))
    console.log('[artifact-integrity] Windows installer input passed ASAR inventory')
    return
  }

  const referenceBundle = path.join(appOutDir, `${event.packager.appInfo.productFilename}.app`)
  const releaseTeamId = releaseTeamIdForEnvironment(process.env)

  console.log(`[artifact-integrity] verifying ${path.basename(event.file)} before publication`)
  if (artifact.endsWith('.dmg')) {
    if (releaseTeamId) {
      await verifyReleaseDmgArtifact(event.file, referenceBundle, releaseTeamId)
      console.log('[artifact-integrity] DMG contains the Developer ID signed, notarized app')
    } else {
      await verifyDmgArtifact(event.file, referenceBundle)
      console.log('[artifact-integrity] DMG bundle matches the locally signed packaged app')
    }
    await runInstalledDmgSmoke(event.file, referenceBundle)
    console.log('[artifact-integrity] installed UI and packaged license smokes passed')
    return
  }

  if (releaseTeamId) {
    await verifyReleaseZipArtifact(event.file, referenceBundle, releaseTeamId)
    console.log('[artifact-integrity] updater ZIP contains the Developer ID signed, notarized app')
  } else {
    await verifyZipArtifact(event.file, referenceBundle)
    console.log('[artifact-integrity] updater ZIP matches the locally signed packaged app')
  }
}
