// service/kb/KbEmbeddingService: embeddings of the wiki pages
// (docs/SUBJECT-WIKI.md "Embeddings").
//
// Indexing: embedPending() finds PUBLISHED pages without chunks for their
// current revision and the configured model, cuts them (KbChunker), embeds the
// chunks and replaces the page's rows. The HTTP call runs outside any
// transaction; the write re-checks the revision, so a page edited meanwhile is
// left for the next sweep.
//
// Search: search() embeds the query and returns the nearest chunks of
// PUBLISHED pages (cosine distance), for RAG.

import type { Deps } from '../../deps';
import { withTx } from '../../db/client';
import { FeatureNotConfiguredError, ValidationError } from '../../http/errors';
import { javaFloat } from '../../lib/json';
import { javaIsBlank, javaStrip } from '../../lib/javaCompat';
import { embeddingClientOf, EmbeddingUnreachableError } from '../../external/llm/embedding';
import { LlmApiError, type EmbeddingClient } from '../../external/llm';
import { chunk, type Chunk } from '../kb/logic/kbChunker';
import { KbEmbeddingProperties } from './embeddingProps';
import * as repo from './repo';

export const SWEEP_PAGE = 100;
export const MAX_K = 50;
/** KbPageChunk.DIMENSIONS (the vector(768) column). */
export const DIMENSIONS = 768;

export interface SweepResult { embedded: number; failed: number; remaining: number }

/** One chunk near a query; distance = cosine distance (0 = same direction, 2 = opposite). */
export interface Hit {
  chunkId: string; pageId: string; subjectId: string; slug: string; title: string; heading: string | null;
  anchor: string | null; content: string; distance: number;
}

export interface EmbeddingPage { id: string; status: string; revision: number; title: string; summary: string; markdown: string }

/** The repository calls the service makes (KbPageRepository + KbPageChunkRepository). */
export interface EmbeddingStore {
  findPageIdsToEmbed(model: string, limit: number): Promise<string[]>;
  countPagesToEmbed(model: string): Promise<number>;
  findPage(id: string): Promise<EmbeddingPage | null>;
  deleteChunks(pageId: string): Promise<void>;
  insertChunk(pageId: string, revision: number, ordinal: number, heading: string | null, anchor: string | null, content: string, model: string, embedding: string): Promise<void>;
  enableIterativeScan(): Promise<void>;
  findNearest(query: string, model: string, subjectId: string | null, k: number): Promise<Hit[]>;
}

/** TransactionTemplate: runs `fn` with a store bound to one transaction. */
export type StoreTx = <T>(fn: (store: EmbeddingStore) => Promise<T>, opts?: { readOnly?: boolean }) => Promise<T>;

export interface Log { warn(msg: string): void; info(msg: string): void }

/** The drizzle store over deps.db. */
export function dbStoreTx(deps: Pick<Deps, 'db'>): StoreTx {
  return (fn, opts = {}) => withTx(deps.db, (tx) => fn({
    findPageIdsToEmbed: (model, limit) => repo.pageIdsToEmbed(tx, model, limit),
    countPagesToEmbed: (model) => repo.countPagesToEmbed(tx, model),
    async findPage(id) {
      const p = await repo.pageById(tx, id);
      return p && { id: p.id, status: p.status, revision: p.revision, title: p.title, summary: p.summary, markdown: p.markdown };
    },
    deleteChunks: (pageId) => repo.deleteChunks(tx, pageId),
    insertChunk: (pageId, revision, ordinal, heading, anchor, content, model, embedding) =>
      repo.insertChunk(tx, { pageId, revision, ordinal, heading, anchor, content, model, embedding }),
    enableIterativeScan: () => repo.enableIterativeScan(tx),
    async findNearest(query, model, subjectId, k) {
      return (await repo.findNearest(tx, query, model, subjectId, k)).map((r) => ({
        chunkId: r.id, pageId: r.page_id, subjectId: r.subject_id, slug: r.slug, title: r.title, heading: r.heading,
        anchor: r.anchor, content: r.content, distance: Number(r.distance),
      }));
    },
  }), { readOnly: opts.readOnly });
}

/** Wrong vector length: a configuration error, ends the sweep. */
export class DimensionMismatchError extends LlmApiError {
  constructor(message: string) {
    super(0, message);
  }
}

/**
 * Errors about the endpoint, not the page: they end the sweep. Anything else
 * (a 400 for one input, a malformed answer, a non-finite value) skips only
 * that page, so one bad page can never hold the rest back.
 */
export function endpointProblem(e: LlmApiError): boolean {
  return e instanceof EmbeddingUnreachableError || e instanceof DimensionMismatchError
    || e.status === 401 || e.status === 403 || e.status === 404;
}

/** pgvector text form: [0.1,0.2,...] with Float.toString digits. */
export function literal(v: Float32Array | number[]): string {
  const parts: string[] = new Array(v.length);
  for (let i = 0; i < v.length; i++) {
    const x = v[i]!;
    if (!Number.isFinite(x)) throw new LlmApiError(0, 'embeddings: non-finite value in vector');
    parts[i] = (javaFloat(x) as unknown as { rawJSON: string }).rawJSON;
  }
  return `[${parts.join(',')}]`;
}

export class KbEmbeddingService {
  constructor(
    private readonly client: EmbeddingClient,
    readonly props: KbEmbeddingProperties,
    private readonly tx: StoreTx,
    private readonly log: Log,
  ) {}

  static of(deps: Pick<Deps, 'db' | 'config' | 'llm' | 'log'>): KbEmbeddingService {
    const log = deps.log.child({ component: 'KbEmbeddingService' });
    return new KbEmbeddingService(embeddingClientOf(deps.config, deps.llm), KbEmbeddingProperties.of(deps.config), dbStoreTx(deps),
      { warn: (m) => log.warn(m), info: (m) => log.info(m) });
  }

  available(): boolean {
    return this.client.available();
  }

  model(): string {
    return this.props.model;
  }

  // Embeds every pending page. Each page is tried at most once per sweep: one
  // that fails is logged and retried on the next sweep, and one that is still
  // pending after its write (edited meanwhile) waits for it too. An endpoint
  // problem ends the sweep.
  async embedPending(): Promise<SweepResult> {
    if (!this.client.available()) return { embedded: 0, failed: 0, remaining: 0 };
    const model = this.props.model;
    const seen = new Set<string>();
    const failed = new Set<string>();
    let embedded = 0;
    sweep:
    while (true) {
      const ids = await this.tx((s) => s.findPageIdsToEmbed(model, SWEEP_PAGE + seen.size), { readOnly: true });
      const todo = ids.filter((id) => { if (seen.has(id)) return false; seen.add(id); return true; });
      if (todo.length === 0) break;
      for (const id of todo) {
        try {
          if (await this.embedPage(id)) embedded++;
        } catch (e) {
          failed.add(id);
          if (e instanceof LlmApiError) {
            // Server down, bad key, unknown model or wrong vector length: every
            // page would fail the same way.
            if (endpointProblem(e)) {
              this.log.warn(`KB embeddings: endpoint unreachable or misconfigured, stopping this sweep: ${e.message}`);
              break sweep;
            }
          }
          this.log.warn(`KB embeddings: page ${id} failed: ${(e as Error)?.message}`);
        }
      }
    }
    const remaining = await this.tx((s) => s.countPagesToEmbed(model), { readOnly: true });
    if (embedded > 0 || failed.size > 0) {
      this.log.info(`KB embeddings (${model}): ${embedded} pages embedded, ${failed.size} failed, ${remaining} pending`);
    }
    return { embedded, failed: failed.size, remaining };
  }

  // Embeds one page's current revision; false when it changed or stopped
  // being PUBLISHED while the vectors were computed (nothing written).
  async embedPage(pageId: string): Promise<boolean> {
    const snap = await this.tx(async (s) => {
      const p = await s.findPage(pageId);
      if (!p || p.status !== 'PUBLISHED') return null;
      return { revision: p.revision, chunks: chunk(p.title, p.summary, p.markdown) };
    }, { readOnly: true });
    if (snap == null) return false;

    const vectors = await this.embedAll(snap.chunks.map((c: Chunk) => this.props.document(c.title, c.body)));

    return this.tx(async (s) => {
      const page = await s.findPage(pageId);
      if (!page || page.status !== 'PUBLISHED' || page.revision !== snap.revision) return false;
      await s.deleteChunks(pageId);
      for (let i = 0; i < snap.chunks.length; i++) {
        const c = snap.chunks[i]!;
        await s.insertChunk(pageId, snap.revision, c.ordinal, c.heading, c.anchor, c.text(), this.props.model, literal(vectors[i]!));
      }
      return true;
    });
  }

  /** The nearest chunks to `query` (subjectId null = every subject). */
  async search(query: string | null, subjectId: string | null, k: number): Promise<Hit[]> {
    if (!this.client.available()) {
      throw new FeatureNotConfiguredError('Wiki search needs an embedding server (KB_EMBEDDING_BASE_URL)');
    }
    if (query == null || javaIsBlank(query)) throw new ValidationError('query', query, 'is required');
    const limit = Math.max(1, Math.min(k, MAX_K));
    const q = literal((await this.embedAll([this.props.query(javaStrip(query))]))[0]!);
    return this.tx(async (s) => {
      await s.enableIterativeScan();
      return s.findNearest(q, this.props.model, subjectId, limit);
    }, { readOnly: true });
  }

  private async embedAll(texts: string[]): Promise<Float32Array[]> {
    const out: Float32Array[] = [];
    const size = this.props.batchSize;
    for (let i = 0; i < texts.length; i += size) {
      const batch = texts.slice(i, Math.min(texts.length, i + size));
      const vectors = await this.client.embed(this.props.model, batch);
      if (vectors.length !== batch.length) {
        throw new LlmApiError(0, `embeddings: ${vectors.length} vectors for ${batch.length} inputs`);
      }
      for (const v of vectors) {
        if (v.length !== DIMENSIONS) {
          throw new DimensionMismatchError(`embeddings: model ${this.props.model} returned ${v.length} dimensions, the column holds ${DIMENSIONS}`);
        }
      }
      out.push(...vectors);
    }
    return out;
  }
}
