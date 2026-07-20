/**
 * After-sign hook for electron-builder.
 *
 * electron-builder signs the app bundle, but the binaries we ship in
 * Contents/Resources/bin (llama-server, whisper, ffmpeg, sd, dylibs) are
 * extraResources it doesn't sign — so they must be signed here, and the outer
 * bundle re-sealed afterwards.
 *
 * CRITICAL: when a Developer ID identity is available (CI / release), we sign
 * with THAT identity + hardened runtime so the build NOTARIZES. Only when no
 * identity exists (local/contributor dev) do we fall back to an ad-hoc signature
 * (runs locally after quarantine removal, but can't be notarized). The previous
 * version always signed ad-hoc, which silently clobbered the Developer ID
 * signature and made every release Gatekeeper-blocked.
 */
const { execSync } = require('child_process')
const path = require('path')
const fs = require('fs')

function findDeveloperId() {
  try {
    const out = execSync('security find-identity -v -p codesigning', { encoding: 'utf8' })
    const m = out.match(/"(Developer ID Application:[^"]+)"/)
    return m ? m[1] : null
  } catch {
    return null
  }
}

exports.default = async function (context) {
  const { appOutDir, packager } = context
  if (packager.platform.name !== 'mac') return

  const appName = packager.appInfo.productFilename
  const appPath = path.join(appOutDir, `${appName}.app`)
  const resourcesPath = path.join(appPath, 'Contents', 'Resources')
  const entitlements = path.join(__dirname, '..', 'build', 'entitlements.mac.plist')
  const hasEnt = fs.existsSync(entitlements)

  const devId = findDeveloperId()
  const identity = devId || '-' // '-' = ad-hoc
  const runtime = devId ? '--options runtime' : ''
  console.log(
    devId
      ? `[resign] Developer ID found — signing + hardened runtime for notarization: ${devId}`
      : '[resign] No Developer ID — ad-hoc signing (local dev; not notarizable)'
  )

  const sign = (filePath, withEntitlements = false) => {
    const ent = withEntitlements && hasEnt ? `--entitlements "${entitlements}"` : ''
    execSync(`codesign --force ${runtime} ${ent} --sign "${identity}" "${filePath}"`, {
      stdio: 'inherit'
    })
  }

  try {
    const binDir = path.join(resourcesPath, 'bin')
    if (fs.existsSync(binDir)) {
      const walk = (dir) => {
        for (const name of fs.readdirSync(dir)) {
          if (name.startsWith('.')) continue
          const p = path.join(dir, name)
          const st = fs.statSync(p)
          if (st.isDirectory()) {
            walk(p)
            continue
          }
          if (name.endsWith('.dylib')) {
            console.log(`[resign] dylib: ${name}`)
            sign(p)
          }
        }
      }
      walk(binDir) // dylibs first (dependencies before dependents)
      const walkExec = (dir) => {
        for (const name of fs.readdirSync(dir)) {
          if (name.startsWith('.')) continue
          const p = path.join(dir, name)
          const st = fs.statSync(p)
          if (st.isDirectory()) {
            walkExec(p)
            continue
          }
          if (name.endsWith('.dylib')) continue
          try {
            fs.accessSync(p, fs.constants.X_OK)
            console.log(`[resign] bin: ${name}`)
            sign(p, true)
          } catch {
            /* not exec */
          }
        }
      }
      walkExec(binDir)
    }

    // Re-seal the outer bundle. With a real identity we DON'T use --deep (that
    // would overwrite the framework/helper entitlements electron-builder set
    // correctly); a top-level re-sign re-establishes the seal over our changed
    // nested binaries. Ad-hoc dev keeps --deep for simplicity.
    console.log('[resign] re-sealing app bundle')
    if (devId) {
      const ent = hasEnt ? `--entitlements "${entitlements}"` : ''
      execSync(`codesign --force ${runtime} ${ent} --sign "${identity}" "${appPath}"`, {
        stdio: 'inherit'
      })
    } else {
      const ent = hasEnt ? `--entitlements "${entitlements}"` : ''
      execSync(`codesign --deep --force --sign - ${ent} "${appPath}"`, { stdio: 'inherit' })
    }
    console.log('[resign] done')
  } catch (error) {
    console.error('[resign] failed:', error)
    throw error
  }
}
