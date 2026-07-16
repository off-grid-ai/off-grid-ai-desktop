import path from 'path';
import { pipeline, env } from '@xenova/transformers';
import { modelsDir } from './runtime-env';

// Configure transformers to look for models locally or cache them properly.
env.localModelPath = modelsDir();
env.allowRemoteModels = true; // Allow download on first run
// Pin the on-disk HTTP cache to a WRITABLE dir. transformers.js defaults cacheDir
// to `<its own module folder>/.cache` — which, in a packaged app, resolves INSIDE
// the read-only app.asar. FileCache.put() then fails every write with ENOTDIR
// (asar is a single file, not a directory), catches it non-fatally, and falls back
// to the in-memory buffer. Net effect: the ~23MB MiniLM download NEVER persists, so
// every embedding re-downloads it from HuggingFace — which times out on a slow link
// and reads as "embeddings model timeout" on a fresh install. Point the cache at the
// same writable userData/models dir we already use for localModelPath so the model
// is downloaded once and read from disk thereafter. Cross-platform: the same asar is
// read-only on macOS too (the signed .app), so this fixes both, not just Windows.
env.cacheDir = path.join(modelsDir(), '.cache');

class EmbeddingService {
  private pipe: any = null;

  async init() {
    if (this.pipe) return;
    console.log("Initializing Embedding Engine...");
    
    // Use a small, efficient model
    this.pipe = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
    console.log("Embedding Engine Ready.");
  }

  async generateEmbedding(text: string): Promise<number[]> {
    if (!this.pipe) await this.init();
    
    // Generate embedding
    const output = await this.pipe(text, { pooling: 'mean', normalize: true });
    return Array.from(output.data);
  }
}

export const embeddings = new EmbeddingService();
