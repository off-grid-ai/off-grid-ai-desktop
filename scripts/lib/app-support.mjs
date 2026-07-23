import fs from 'fs'
import os from 'os'
import path from 'path'

const packageJson = JSON.parse(
  fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf8')
)

export const PRODUCT_NAME = packageJson.productName

if (typeof PRODUCT_NAME !== 'string' || !PRODUCT_NAME.trim()) {
  throw new Error('package.json must declare productName')
}

export function getAppSupportDir(platform = process.platform) {
  if (platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', PRODUCT_NAME)
  }
  if (platform === 'win32') {
    return path.join(process.env.APPDATA || os.homedir(), PRODUCT_NAME)
  }
  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), PRODUCT_NAME)
}
