import { execFile, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const root = path.resolve(import.meta.dirname, '../../..')
const electronVite = path.join(root, 'node_modules', '.bin', 'electron-vite')
const tempRoots: string[] = []
const execFileAsync = promisify(execFile)
const BUILD_TIMEOUT_MS = 90_000

function tempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  tempRoots.push(dir)
  return dir
}

function filesBelow(dir: string): string[] {
  return fs
    .readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .map((entry) => path.join(dir, entry))
    .filter((entry) => fs.statSync(entry).isFile())
}

function bundleText(dir: string): string {
  return filesBelow(dir)
    .filter((file) => /\.(?:html|js)$/.test(file))
    .map((file) => fs.readFileSync(file, 'utf8'))
    .join('\n')
}

/** Repository-owned source modules Rollup resolved into an artifact. Sourcemaps are
 * build metadata emitted only for this test; unlike sentinel bundle strings, their
 * complete source lists fail when any new private module leaks into the core graph. */
function repositorySources(dir: string): Set<string> {
  const sources = filesBelow(dir)
    .filter((file) => file.endsWith('.map'))
    .flatMap((mapFile) => {
      const map = JSON.parse(fs.readFileSync(mapFile, 'utf8')) as { sources?: string[] }
      return (map.sources ?? []).map((source) => path.resolve(path.dirname(mapFile), source))
    })
    .filter((source) => source.startsWith(`${root}${path.sep}`))
    .map((source) => path.relative(root, source).split(path.sep).join('/'))

  return new Set(sources)
}

function writeExecutable(file: string, source: string): void {
  fs.writeFileSync(file, source, { mode: 0o755 })
}

async function buildArtifact(outDir: string, forceCore: '0' | '1'): Promise<void> {
  await execFileAsync(
    electronVite,
    ['build', '--outDir', outDir, '--sourcemap', '--logLevel', 'error'],
    {
      cwd: root,
      env: { ...process.env, OFFGRID_FORCE_CORE: forceCore },
      maxBuffer: 10 * 1024 * 1024,
      timeout: BUILD_TIMEOUT_MS
    }
  )
}

type LlamaFixtureMode = 'healthy' | 'missing-rpath' | 'foreign-dependency'

function runBuildLlama(mode: LlamaFixtureMode): ReturnType<typeof spawnSync> & {
  sandbox: string
} {
  const sandbox = tempDir('offgrid-llama-build-')
  const scriptDir = path.join(sandbox, 'scripts')
  const fakeBin = path.join(sandbox, 'fake-bin')
  fs.mkdirSync(scriptDir)
  fs.mkdirSync(fakeBin)
  fs.copyFileSync(
    path.join(root, 'scripts', 'build-llama.sh'),
    path.join(scriptDir, 'build-llama.sh')
  )

  writeExecutable(
    path.join(fakeBin, 'git'),
    `#!/usr/bin/env bash
set -euo pipefail
mkdir -p "${'$'}{!#}"
`
  )
  writeExecutable(
    path.join(fakeBin, 'cmake'),
    `#!/usr/bin/env bash
set -euo pipefail
mkdir -p build/bin build/lib
printf '#!/bin/sh\\nexit 0\\n' > build/bin/llama-server
chmod +x build/bin/llama-server
printf 'fixture dylib\\n' > build/lib/libggml.0.15.3.dylib
ln -sfn libggml.0.15.3.dylib build/lib/libggml.0.dylib
`
  )
  writeExecutable(path.join(fakeBin, 'sysctl'), '#!/usr/bin/env bash\nprintf "4\\n"\n')
  writeExecutable(
    path.join(fakeBin, 'otool'),
    `#!/usr/bin/env bash
set -euo pipefail
if [ "${'$'}1" = "-l" ]; then
  printf 'Load command 1\\n      cmd LC_BUILD_VERSION\\n    minos 13.0\\n'
  exit 0
fi
file="${'$'}2"
printf '%s:\\n' "${'$'}file"
if [ "${'$'}{file##*/}" = "llama-server" ]; then
  printf '    @rpath/libggml.0.dylib (compatibility version 0.0.0, current version 0.0.0)\\n'
  if [ "${mode}" = "missing-rpath" ]; then
    printf '    @rpath/libmissing.0.dylib (compatibility version 0.0.0, current version 0.0.0)\\n'
  fi
  if [ "${mode}" = "foreign-dependency" ]; then
    printf '    /opt/homebrew/opt/openssl/lib/libssl.dylib (compatibility version 0.0.0, current version 0.0.0)\\n'
  fi
fi
printf '    /usr/lib/libSystem.B.dylib (compatibility version 1.0.0, current version 1.0.0)\\n'
`
  )

  const result = spawnSync('bash', [path.join(scriptDir, 'build-llama.sh')], {
    cwd: sandbox,
    env: {
      ...process.env,
      PATH: `${fakeBin}:${process.env.PATH ?? ''}`,
      LLAMA_REF: 'fixture-ref',
      MACOS_DEPLOYMENT_TARGET: '13.0'
    },
    encoding: 'utf8'
  })
  return Object.assign(result, { sandbox })
}

describe.sequential('release packaging integration', () => {
  let coreOut: string
  let proOut: string

  beforeAll(
    async () => {
      coreOut = tempDir('offgrid-core-bundle-')
      proOut = tempDir('offgrid-pro-bundle-')

      await buildArtifact(coreOut, '1')
      await buildArtifact(proOut, '0')
    },
    BUILD_TIMEOUT_MS * 2 + 10_000
  )

  afterAll(() => {
    for (const dir of tempRoots) {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('builds a core artifact with the locked shell but without private implementation', () => {
    const coreFiles = filesBelow(coreOut).map((file) => path.basename(file))
    const core = bundleText(coreOut)
    const coreSources = repositorySources(coreOut)
    const privateSources = [...coreSources].filter((source) => source.startsWith('pro/'))

    expect(coreFiles.some((file) => file.startsWith('proStub-'))).toBe(true)
    expect(privateSources).toEqual([])
    expect([...coreSources]).toEqual(
      expect.arrayContaining([
        'src/bootstrap/proStub.ts',
        'src/main/bootstrap/loadProFeaturesMain.ts',
        'src/main/bootstrap/pro-activation.ts',
        'src/renderer/src/bootstrap/loadProFeaturesRenderer.ts',
        'src/renderer/src/components/pro/UpgradeScreen.tsx',
        'src/renderer/src/components/pro/proCatalog.ts',
        'src/renderer/src/components/pro/proSettingsCatalog.ts'
      ])
    )
    expect(core).toContain('Unlock Pro')
    expect(core).not.toContain('[pro] main activated')
    expect(core).not.toContain('vault:status')
  })

  it('builds the Pro artifact with its production activation and entitled implementation', () => {
    const pro = bundleText(proOut)
    const proSources = repositorySources(proOut)

    expect(proSources.has('src/bootstrap/proStub.ts')).toBe(false)
    expect([...proSources]).toEqual(
      expect.arrayContaining([
        'src/main/bootstrap/loadProFeaturesMain.ts',
        'src/main/bootstrap/pro-activation.ts',
        'src/renderer/src/bootstrap/loadProFeaturesRenderer.ts',
        'src/renderer/src/components/pro/UpgradeScreen.tsx',
        'pro/main/index.ts',
        'pro/renderer/index.tsx'
      ])
    )
    expect(pro).toContain('[pro] main activated')
    expect(pro).toContain('vault:status')
  })

  it('keeps the helper payload hydrated and executable before electron-builder copies it', () => {
    const builder = fs.readFileSync(path.join(root, 'electron-builder.yml'), 'utf8')
    expect(builder).toContain("- '!pro/**'")
    expect(builder).toMatch(/extraResources:\n\s+- from: resources\n\s+to: \.\n/)

    const helpers = [
      'bin/llama/llama-server',
      'bin/ffmpeg',
      'bin/whisper/whisper-cli',
      'bin/llama/libggml.0.dylib'
    ]
    for (const relative of helpers) {
      const file = path.join(root, 'resources', relative)
      const stat = fs.statSync(file)
      const prefix = fs.readFileSync(file).subarray(0, 200).toString('utf8')
      expect(stat.isFile(), relative).toBe(true)
      expect(stat.size, relative).toBeGreaterThan(200)
      expect(prefix, relative).not.toContain('git-lfs.github.com/spec')
    }

    for (const relative of helpers.slice(0, 3)) {
      expect(fs.statSync(path.join(root, 'resources', relative)).mode & 0o111, relative).not.toBe(0)
    }
  })

  it('stages exact dylib names as real files and accepts a closed llama dependency graph', () => {
    const result = runBuildLlama('healthy')
    const llamaDir = path.join(result.sandbox, 'resources', 'bin', 'llama')

    expect(result.status, String(result.stderr)).toBe(0)
    expect(result.stdout).toContain('no foreign deps, all @rpath libs present')
    expect(fs.lstatSync(path.join(llamaDir, 'libggml.0.dylib')).isFile()).toBe(true)
    expect(fs.lstatSync(path.join(llamaDir, 'libggml.0.dylib')).isSymbolicLink()).toBe(false)
  })

  it('blocks a llama build when an exact @rpath dependency is absent', () => {
    const result = runBuildLlama('missing-rpath')
    const output = `${result.stdout}\n${result.stderr}`

    expect(result.status).not.toBe(0)
    expect(output).toContain('engine references @rpath libs NOT bundled: libmissing.0.dylib')
  })

  it('blocks a llama build that leaks a Homebrew dependency', () => {
    const result = runBuildLlama('foreign-dependency')
    const output = `${result.stdout}\n${result.stderr}`

    expect(result.status).not.toBe(0)
    expect(output).toContain('engine links non-system libs')
    expect(output).toContain('/opt/homebrew/opt/openssl/lib/libssl.dylib')
  })
})
