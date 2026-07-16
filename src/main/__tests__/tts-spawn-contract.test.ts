import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// Regression guard for the live TTS "spawn ENOTDIR" failure. tts.ts spawns the Kokoro
// worker as Electron-as-Node; it used to pass `cwd: appRoot()`, and in a PACKAGED build
// appRoot() (app.getAppPath()) is `app.asar` - a FILE. Node's spawn throws ENOTDIR when
// `cwd` is not a directory, so TTS was dead in every shipped build (dev worked: appRoot
// resolved to the project dir). The fix drops `cwd` entirely (the worker gets an absolute
// script path; Node resolves its deps relative to that file, not cwd) - matching how STT
// spawns. tts.ts pulls in electron and can't be imported in a node test, so this guards the
// contract at the source (same style as llm-http-no-keepalive.test.ts).
const src = readFileSync(join(__dirname, '..', 'tts.ts'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\/\/.*$/gm, '')

describe('tts.ts worker spawn never passes a cwd (ENOTDIR guard)', () => {
  it('has no `cwd:` option on any spawn (an asar-file cwd throws ENOTDIR in the packaged app)', () => {
    // Any `cwd:` in the (comment-stripped) source is the regression: it can resolve to the
    // app.asar file in a packaged build. The worker needs no cwd.
    expect(src).not.toMatch(/\bcwd\s*:/)
  })

  it('still spawns the worker as Electron-as-Node with an absolute worker path', () => {
    // The fix removed only `cwd` - the rest of the launch contract must stay intact.
    expect(src).toMatch(/spawn\(process\.execPath,\s*\[workerPath\(\)/)
    expect(src).toMatch(/ELECTRON_RUN_AS_NODE:\s*'1'/)
  })
})
