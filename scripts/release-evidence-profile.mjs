/* eslint-disable @typescript-eslint/explicit-function-return-type -- JavaScript harness module */
import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'

const PROTECTED_ENVIRONMENT_KEYS = [
  'OFFGRID_PRO',
  'OFFGRID_SEED',
  'OFFGRID_SEED_PRO',
  'OFFGRID_USER_DATA'
]

export function createEvidenceProfile(label) {
  const safeLabel = label.replace(/[^a-z0-9-]/gi, '-').toLowerCase()
  return mkdtempSync(join(realpathSync(tmpdir()), `offgrid-evidence-${safeLabel}-`))
}

function assertIsolatedProfile(profile) {
  const temporaryRoot = realpathSync(tmpdir())
  const resolvedProfile = realpathSync(profile)
  const pathFromTemporaryRoot = relative(temporaryRoot, resolvedProfile)
  if (
    pathFromTemporaryRoot === '' ||
    pathFromTemporaryRoot.startsWith('..') ||
    pathFromTemporaryRoot.includes('/../')
  ) {
    throw new Error('Release evidence must use an isolated temporary profile')
  }
  return resolvedProfile
}

export function evidenceEnvironment({
  profile,
  pro = false,
  seedCore = false,
  seedPro = false,
  extra = {}
}) {
  const environment = { ...process.env, ...extra }
  for (const key of PROTECTED_ENVIRONMENT_KEYS) delete environment[key]

  environment.OFFGRID_PRO = pro ? '1' : '0'
  environment.OFFGRID_USER_DATA = assertIsolatedProfile(profile)
  if (seedCore) environment.OFFGRID_SEED = '1'
  if (seedPro) environment.OFFGRID_SEED_PRO = '1'
  return environment
}

export function removeEvidenceProfile(profile) {
  rmSync(assertIsolatedProfile(profile), { recursive: true, force: true })
}
