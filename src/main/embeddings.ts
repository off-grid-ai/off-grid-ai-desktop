import { pipeline, env } from '@xenova/transformers';
import { modelsDir } from './runtime-env';

// Configure transformers to look for models locally or cache them properly
env.localModelPath = modelsDir();
env.allowRemoteModels = true; // Allow download on first run

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
