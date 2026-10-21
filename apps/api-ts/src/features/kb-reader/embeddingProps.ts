// config/KbEmbeddingProperties: the normalization its compact constructor does
// over kb.embeddings.* (src/config/sections/kb.ts holds the raw values).

import type { Config } from '../../config';
import { javaIsBlank, javaTrim, replaceLiteral } from '../../lib/javaCompat';

/** EmbeddingGemma's retrieval prompts (model card, "SearchQuery" / "Document"). */
export const GEMMA_QUERY = 'task: search result | query: {query}';
export const GEMMA_DOCUMENT = 'title: {title} | text: {text}';

export class KbEmbeddingProperties {
  readonly baseUrl: string;
  readonly apiKey: string | null;
  readonly model: string;
  readonly queryTemplate: string;
  readonly documentTemplate: string;
  readonly useFake: boolean;
  readonly batchSize: number;
  readonly requestTimeoutMs: number;

  constructor(raw: {
    baseUrl?: string | null; apiKey?: string | null; model?: string | null; queryTemplate?: string | null;
    documentTemplate?: string | null; useFake?: boolean; batchSize?: number | null; requestTimeoutMs?: number | null;
  }) {
    this.baseUrl = javaTrim(raw.baseUrl ?? '').replace(/\/+$/, '');
    this.apiKey = raw.apiKey ?? null;
    this.model = raw.model == null || javaIsBlank(raw.model) ? 'embeddinggemma-2' : javaTrim(raw.model);
    this.queryTemplate = raw.queryTemplate == null || javaIsBlank(raw.queryTemplate) ? GEMMA_QUERY : raw.queryTemplate;
    this.documentTemplate = raw.documentTemplate == null || javaIsBlank(raw.documentTemplate) ? GEMMA_DOCUMENT : raw.documentTemplate;
    this.useFake = raw.useFake ?? false;
    this.batchSize = raw.batchSize == null || raw.batchSize < 1 ? 16 : raw.batchSize;
    this.requestTimeoutMs = raw.requestTimeoutMs == null || raw.requestTimeoutMs <= 0 ? 120_000 : raw.requestTimeoutMs;
  }

  static of(config: Config): KbEmbeddingProperties {
    return new KbEmbeddingProperties(config.kb.embeddings);
  }

  configured(): boolean {
    return this.baseUrl !== '';
  }

  query(query: string): string {
    return replaceLiteral(this.queryTemplate, '{query}', query);
  }

  document(title: string, text: string): string {
    return replaceLiteral(replaceLiteral(this.documentTemplate, '{title}', title), '{text}', text);
  }
}
