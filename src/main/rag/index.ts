// Assembles the desktop RAG: the shared RagService over the better-sqlite3
// store, MiniLM embeddings, and the Node/native extraction bridges. Project chat
// runs through the main rag_conversations path (ipc.ts); the old project_threads
// backend was removed as dead code.

import { RagService } from '@offgrid/rag';
import type { EmbeddingProvider } from '@offgrid/rag';
import { embeddings } from '../embeddings';
import { desktopVectorStore } from './store';
import { desktopExtraction } from './extractors';

const embeddingProvider: EmbeddingProvider = {
  dimension: 384,
  embed: (text) => embeddings.generateEmbedding(text),
};

export const ragService = new RagService({
  store: desktopVectorStore,
  embeddings: embeddingProvider,
  extraction: desktopExtraction,
  chunkOptions: { chunkSize: 600, overlap: 120, minChunkLength: 20 },
});

export * from './store';
