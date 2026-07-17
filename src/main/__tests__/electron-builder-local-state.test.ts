import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const builderConfig = fs.readFileSync(
  path.resolve(__dirname, '../../../electron-builder.yml'),
  'utf8'
)

describe('electron-builder local-state admission', () => {
  it.each(['.demo-profile', '.offgrid', '.claude', '.Codex', 'coverage'])(
    'excludes %s before electron-builder traverses project files',
    (directory) => {
      const localStateExclusion = builderConfig.match(/'!\{([^}]+)\}\/\*\*'/)?.[1]?.split(',')
      expect(localStateExclusion).toContain(directory)
    }
  )
})
