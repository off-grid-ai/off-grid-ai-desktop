// Real gate on the SHIPPED whisper-cli binary: it must carry an @loader_path (or
// @executable_path) rpath so dyld resolves the libwhisper/libggml dylibs staged next
// to it. Without it, dyld dies "Library not loaded: @rpath/libwhisper.1.dylib" and
// voice-note transcription fails silently (the "nothing happened" bug). The old
// build gate only checked the dylibs were STAGED, not that the binary could FIND them.
// No mocks — this reads the actual committed Mach-O with the system otool.
import { describe, it, expect } from 'vitest'
import { execFileSync, spawnSync } from 'child_process'
import { existsSync, lstatSync } from 'fs'
import path from 'path'

const WHISPER_DIR = path.join(process.cwd(), 'resources', 'bin', 'whisper')
const CLI = path.join(WHISPER_DIR, 'whisper-cli')
const darwinWithBinary = process.platform === 'darwin' && existsSync(CLI)

function rpaths(binary: string): string[] {
  const out = execFileSync('otool', ['-l', binary], { encoding: 'utf8' })
  const lines = out.split('\n')
  const paths: string[] = []
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]?.includes('LC_RPATH')) {
      const pathLine = lines[i + 2] ?? ''
      const m = /\bpath\s+(\S+)/.exec(pathLine)
      if (m?.[1]) {
        paths.push(m[1])
      }
    }
  }
  return paths
}

function rpathDeps(binary: string): string[] {
  const out = execFileSync('otool', ['-L', binary], { encoding: 'utf8' })
  return out
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('@rpath/'))
    .map((l) => (l.split(/\s+/)[0] ?? '').replace('@rpath/', ''))
}

describe.skipIf(!darwinWithBinary)('shipped whisper-cli can load its dylibs', () => {
  it('has a @loader_path/@executable_path rpath (so @rpath/ resolves the siblings)', () => {
    const rs = rpaths(CLI)
    expect(rs.some((r) => r === '@loader_path' || r.startsWith('@executable_path'))).toBe(true)
    // No absolute build-machine rpaths that would leak or dangle on a user's Mac.
    expect(rs.every((r) => r.startsWith('@'))).toBe(true)
  })

  it('every @rpath dependency is staged as a real file next to the binary', () => {
    for (const dep of rpathDeps(CLI)) {
      const sibling = path.join(WHISPER_DIR, dep)
      expect(existsSync(sibling), `${dep} staged`).toBe(true)
      expect(lstatSync(sibling).isSymbolicLink(), `${dep} is a real file, not a symlink`).toBe(false)
    }
  })

  it('actually loads: running it produces no dyld "Library not loaded" failure', () => {
    // The decisive signal is dyld resolving the deps, not the exit code / which
    // stream usage prints on (whisper-cli writes usage to stderr, exit 0). spawnSync
    // captures both streams regardless of exit code and never throws.
    const res = spawnSync(CLI, ['--help'], { encoding: 'utf8' })
    const combined = `${res.stdout ?? ''}${res.stderr ?? ''}`
    expect(combined).not.toMatch(/Library not loaded|dyld\[/i)
    expect(combined.toLowerCase()).toContain('usage')
  })
})
