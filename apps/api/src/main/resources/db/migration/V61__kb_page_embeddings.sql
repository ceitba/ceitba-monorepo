-- Embeddings of the subject wiki pages, for semantic search / RAG
-- (docs/SUBJECT-WIKI.md "Embeddings"). Needs the pgvector extension, shipped
-- by the pgvector/pgvector image (docker-compose.yml). Vectors come from the
-- self-hosted EmbeddingGemma 2 (768 dimensions; text and images share one space,
-- so image embeddings can join later without re-embedding the text).
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public;

-- One row per chunk of a page: chunk 0 is the title, summary and the text
-- before the first ## heading; then one chunk per ## section (split further
-- when long). A page's chunks are replaced together whenever its revision or
-- the embedding model changes (KbEmbeddingService). Rows of HIDDEN/REMOVED
-- pages stay; searches only return PUBLISHED pages.
CREATE TABLE "wiki"."kb_page_chunk" (
    "id"            UUID          NOT NULL DEFAULT gen_random_uuid(),
    "page_id"       UUID          NOT NULL,
    -- kb_page.revision the chunk was cut from.
    "page_revision" INTEGER       NOT NULL,
    "ordinal"       INTEGER       NOT NULL,
    -- The ## heading and its anchor (KbWikilinks.anchor); null for chunk 0.
    "heading"       TEXT,
    "anchor"        VARCHAR(256),
    -- The text that was embedded (wikilinks reduced to their text).
    "content"       TEXT          NOT NULL,
    "model"         VARCHAR(128)  NOT NULL,
    "embedding"     public.vector(768) NOT NULL,
    "created_at"    TIMESTAMPTZ   NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "kb_page_chunk_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "kb_page_chunk_page_id_fkey"
        FOREIGN KEY ("page_id") REFERENCES "wiki"."kb_page" ("id") ON DELETE CASCADE,
    CONSTRAINT "kb_page_chunk_page_ordinal_key" UNIQUE ("page_id", "ordinal")
);

-- Cosine kNN (`embedding <=> :query`). HNSW, unlike ivfflat, needs no
-- training data, so it works from an empty table.
CREATE INDEX "kb_page_chunk_embedding_idx" ON "wiki"."kb_page_chunk"
    USING hnsw ("embedding" public.vector_cosine_ops);
