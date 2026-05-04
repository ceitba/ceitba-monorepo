-- =============================================================================
-- V8__article_authors_array.sql
--
-- Replaces the single-author string column with a JSONB array, mirroring the
-- pattern already used for `body`. Existing rows are migrated to a one-element
-- array so no data is lost.
-- =============================================================================

ALTER TABLE public.articles
    ADD COLUMN authors JSONB NOT NULL DEFAULT '[]';

UPDATE public.articles
   SET authors = jsonb_build_array(author)
 WHERE author IS NOT NULL;

ALTER TABLE public.articles
    DROP COLUMN author;
