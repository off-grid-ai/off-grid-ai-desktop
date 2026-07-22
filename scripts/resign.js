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

const resign = {
  findDeveloperId() {
    try {
      const out = execSync('security find-identity -v -p codesigning', { encoding: 'utf8' })
      const match = out.match(/"(Developer ID Application:[^"]+)"/)
      return match ? match[1] : null
    } catch {
      return null
    }
  },

  async afterSign(context) {
    const { appOutDir, packager } = context
    if (packager.platform.name !== 'mac') return

    const appName = packager.appInfo.productFilename
    const appPath = path.join(appOutDir, `${appName}.app`)
    const resourcesPath = path.join(appPath, 'Contents', 'Resources')
    const entitlements = path.join(__dirname, '..', 'build', 'entitlements.mac.plist')
    const hasEnt = fs.existsSync(entitlements)

    const devId = resign.findDeveloperId()
    const identity = devId || '-' // '-' = ad-hoc
    const runtime = devId ? '--options runtime' : ''
    console.log(
      devId
        ? `[resign] Developer ID found — signing + hardened runtime for notarization: ${devId}`
        : '[resign] No Developer ID — ad-hoc signing (local dev; not notarizable)'
    )

    const signing = {
      sign(filePath, withEntitlements = false) {
        const ent = withEntitlements && hasEnt ? `--entitlements "${entitlements}"` : ''
        execSync(`codesign --force ${runtime} ${ent} --sign "${identity}" "${filePath}"`, {
          stdio: 'inherit'
        })
      },
      walkLibraries(dir) {
        for (const name of fs.readdirSync(dir)) {
          if (name.startsWith('.')) continue
          const itemPath = path.join(dir, name)
          const stat = fs.statSync(itemPath)
          if (stat.isDirectory()) {
            signing.walkLibraries(itemPath)
            continue
          }
          if (name.endsWith('.dylib')) {
            console.log(`[resign] dylib: ${name}`)
            signing.sign(itemPath)
          }
        }
      },
      walkExecutables(dir) {
        for (const name of fs.readdirSync(dir)) {
          if (name.startsWith('.')) continue
          const itemPath = path.join(dir, name)
          const stat = fs.statSync(itemPath)
          if (stat.isDirectory()) {
            signing.walkExecutables(itemPath)
            continue
          }
          if (name.endsWith('.dylib')) continue
          try {
            fs.accessSync(itemPath, fs.constants.X_OK)
            console.log(`[resign] bin: ${name}`)
            signing.sign(itemPath, true)
          } catch {
            /* not exec */
          }
        }
      }
    }

    try {
      const binDir = path.join(resourcesPath, 'bin')
      if (fs.existsSync(binDir)) {
        signing.walkLibraries(binDir) // dylibs first (dependencies before dependents)
        signing.walkExecutables(binDir)
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
}

exports.default = resign.afterSign
