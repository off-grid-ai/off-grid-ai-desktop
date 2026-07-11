import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

// Regression guard for the boot crash "Cannot access 'transcriptionService' before
// initialization" (a temporal-dead-zone from a module-load cycle). select.ts reads the
// engine-service singletons at module scope (`const ALL = { whisper, ... }`), so no module
// that select imports may import select back. The pure classifiers therefore live in the
// LEAF module classify.ts, which the CLIs import instead of select. This test fails the
// moment someone reintroduces the cycle - unit tests alone did NOT catch the original crash
// (it only manifests in the bundled main-process load order), so we assert the structure.
const dir = join(__dirname, '..');
const read = (f: string): string => readFileSync(join(dir, f), 'utf8');

describe('transcription module load-cycle guard', () => {
  it('classify.ts is a leaf - it must not import ./select', () => {
    expect(read('classify.ts')).not.toMatch(/from ['"]\.\/select['"]/);
  });

  it('whisper-cli imports the classifiers from ./classify, not ./select', () => {
    const src = read('whisper-cli.ts');
    expect(src).toMatch(/import \{[^}]*catalogEngine[^}]*\} from ['"]\.\/classify['"]/);
    expect(src).not.toMatch(/from ['"]\.\/select['"]/);
  });

  it('parakeet-cli imports the classifiers from ./classify, not ./select', () => {
    const src = read('parakeet-cli.ts');
    expect(src).toMatch(/import \{[^}]*modelsByEngine[^}]*\} from ['"]\.\/classify['"]/);
    expect(src).not.toMatch(/from ['"]\.\/select['"]/);
  });

  it('select still re-exports the classifiers so existing importers keep working', async () => {
    // Importing select must RESOLVE (this is the module whose `const ALL` crashed on
    // load). A sync `expect(fn).not.toThrow()` can't catch a rejected dynamic import, so
    // assert the promise resolves and the re-exports are present.
    const mod = await import('../select');
    expect(typeof mod.catalogEngine).toBe('function');
    expect(typeof mod.modelsByEngine).toBe('function');
  });
});
