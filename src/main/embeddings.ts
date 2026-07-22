import path from 'path'
import { pipeline, env, type FeatureExtractionPipeline } from '@xenova/transformers'
import { modelsDir } from './runtime-env'

// Configure transformers to look for models locally or cache them properly
env.localModelPath = modelsDir()
env.allowRemoteModels = true // Allow download on first run
// transformers.js otherwise caches beside its own package, which is read-only
// inside a packaged app.asar. Keep downloads in the writable model directory.
env.cacheDir = path.join(modelsDir(), '.cache')

class EmbeddingService {
  private pipe: FeatureExtractionPipeline | null = null

  async init(): Promise<void> {
    if (this.pipe) return
    console.log('Initializing Embedding Engine...')

    // Use a small, efficient model
    this.pipe = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2')
    console.log('Embedding Engine Ready.')
  }

  async generateEmbedding(text: string): Promise<number[]> {
    if (!this.pipe) await this.init()
    if (!this.pipe) throw new Error('Embedding pipeline did not initialize')

    // Generate embedding
    const output = await this.pipe(text, { pooling: 'mean', normalize: true })
    return Array.from(output.data)
  }
}

export const embeddings = new EmbeddingService()
