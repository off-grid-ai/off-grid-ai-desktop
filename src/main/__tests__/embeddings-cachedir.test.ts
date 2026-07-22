/**
 * Regression guard for the "embeddings model timeout" bug (Windows, fresh install).
 *
 * transformers.js defaults `env.cacheDir` to `<its own module dir>/.cache`, which in
 * a packaged app resolves INSIDE the read-only app.asar. FileCache.put() then fails
 * every write with ENOTDIR (asar is a file, not a dir) and swallows it — so the
 * ~23MB MiniLM download is NEVER persisted and every embedding re-downloads it from
 * HuggingFace. On a slow link that repeated full download surfaces as a "timeout".
 * (Confirmed on a Windows box: download + onnxruntime + network all fine; 8 ENOTDIR
 * warnings from FileCache.put per operation; nothing cached to disk.)
 *
 * The fix pins `env.cacheDir` to a writable dir under the userData models dir. This
 * test fails if that assignment regresses back to the library default. It also guards
 * the cross-platform contract: the same asar is read-only on macOS, so the cache dir
 * must be the writable userData path on BOTH platforms, never inside the package.
 */
import { describe, it, expect } from 'vitest'
import path from 'path'
import os from 'os'

describe('embeddings on-disk cache is a writable dir (not inside app.asar / the package)', () => {
  it('points transformers cacheDir at the userData models dir', async () => {
    // runtime-env resolves the data dir from OFFGRID_DATA_DIR; set it BEFORE the
    // module import, since embeddings.ts reads modelsDir() at load time.
    const dataDir = path.join(os.tmpdir(), 'offgrid-embed-cachedir-test')
    process.env.OFFGRID_DATA_DIR = dataDir

    const { env } = await import('@xenova/transformers')
    await import('../embeddings') // sets env.localModelPath / cacheDir / allowRemoteModels on load

    const modelsDir = path.join(dataDir, 'models')
    expect(env.cacheDir).toBe(path.join(modelsDir, '.cache'))
    // The download target and the local-model lookup must share the writable dir.
    expect(env.localModelPath).toBe(modelsDir)
    // Must NOT be the library default, which lives inside the (read-only-when-packaged)
    // @xenova/transformers package folder.
    expect(env.cacheDir).not.toMatch(/@xenova[\\/]transformers/)
    // Still allow the first-run download (offline bundling is a separate decision).
    expect(env.allowRemoteModels).toBe(true)
  })
})
