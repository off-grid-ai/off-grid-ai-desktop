import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import pkg from '../../../package.json'
import { PRODUCT_NAME } from '../../shared/product-identity'

const root = path.resolve(import.meta.dirname, '../../..')

describe('installed product identity', () => {
  it('keeps runtime and every packaging path on the canonical desktop name', () => {
    expect(PRODUCT_NAME).toBe('Off Grid AI Desktop')
    expect(pkg.productName).toBe(PRODUCT_NAME)

    const builder = fs.readFileSync(path.join(root, 'electron-builder.yml'), 'utf8')
    expect(builder).toMatch(/^productName: Off Grid AI Desktop$/m)

    const localBuild = fs.readFileSync(path.join(root, 'scripts/build-mac-local.sh'), 'utf8')
    expect(localBuild.match(/-c\.productName="Off Grid AI Desktop"/g)).toHaveLength(2)
    expect(localBuild).not.toMatch(/-c\.productName="Off Grid AI(?: Pro)?"/)
  })
})
