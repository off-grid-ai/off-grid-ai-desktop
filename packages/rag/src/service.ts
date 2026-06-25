// RagService: ties the bridges together. indexDocument extracts -> chunks ->
// embeds -> stores; searchProject embeds the query and ranks stored chunks.
// Mirrors Off Grid Mobile's RagService surface so the apps wire it the same way.

import { chunkText, type ChunkOptions } from './chunking';
import { extractContent, type ExtractOptions } from './extract';
import {
  rankBySimilarity,
  selectWithinBudget,
  estimateCharBudget,
  formatForPrompt,
} from './retrieval';
import type { EmbeddingProvider, VectorStore, ExtractionBridges } from './bridges';
import type { RagDocument, SearchResult } from './types';

export type IndexStage = 'extracting' | 'chunking' | 'embedding' | 'indexing' | 'done';

export interface RagServiceDeps {
  store: VectorStore;
  embeddings: EmbeddingProvider;
  extraction: ExtractionBridges;
  chunkOptions?: ChunkOptions;
}

export interface IndexResult {
  docId: number;
  chunkCount: number;
  kind: RagDocument['kind'];
}

export class RagService {
  constructor(private readonly deps: RagServiceDeps) {}

  /** Ingest a file into a project's knowledge base. */
  async indexDocument(
    params: {
      projectId: string;
      path: string;
      fileName: string;
      size: number;
      extract?: ExtractOptions;
    },
    onProgress?: (stage: IndexStage) => void
  ): Promise<IndexResult> {
    onProgress?.('extracting');
    const { text, kind } = await extractContent(
      params.path,
      params.fileName,
      this.deps.extraction,
      params.extract
    );

    onProgress?.('chunking');
    const chunks = chunkText(text, this.deps.chunkOptions);

    const docId = await this.deps.store.addDocument({
      projectId: params.projectId,
      name: params.fileName,
      path: params.path,
      size: params.size,
      kind,
    });

    if (chunks.length === 0) {
      onProgress?.('done');
      return { docId, chunkCount: 0, kind };
    }

    onProgress?.('embedding');
    const texts = chunks.map((c) => c.content);
    const embeddings = this.deps.embeddings.embedBatch
      ? await this.deps.embeddings.embedBatch(texts)
      : await Promise.all(texts.map((t) => this.deps.embeddings.embed(t)));

    onProgress?.('indexing');
    await this.deps.store.addChunks(docId, chunks, embeddings);

    onProgress?.('done');
    return { docId, chunkCount: chunks.length, kind };
  }

  /** Retrieve the most relevant excerpts for a query within a project. */
  async searchProject(
    projectId: string,
    query: string,
    opts: { topK?: number; contextLength?: number } = {}
  ): Promise<SearchResult> {
    const candidates = await this.deps.store.getChunkCandidates(projectId);
    if (candidates.length === 0) return { chunks: [], query };

    const queryVec = await this.deps.embeddings.embed(query);
    let ranked = rankBySimilarity(queryVec, candidates, opts.topK ?? 5);
    if (opts.contextLength) {
      ranked = selectWithinBudget(ranked, estimateCharBudget(opts.contextLength));
    }
    return { chunks: ranked, query };
  }

  /** Build a prompt-ready block from a search result. */
  formatForPrompt(result: SearchResult): string {
    return formatForPrompt(result);
  }

  listDocuments(projectId: string): Promise<RagDocument[]> {
    return this.deps.store.listDocuments(projectId);
  }

  toggleDocument(docId: number, enabled: boolean): Promise<void> {
    return this.deps.store.setDocumentEnabled(docId, enabled);
  }

  deleteDocument(docId: number): Promise<void> {
    return this.deps.store.deleteDocument(docId);
  }
}
