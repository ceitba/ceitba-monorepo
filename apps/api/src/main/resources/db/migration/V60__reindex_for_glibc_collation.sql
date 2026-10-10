-- The database image moves from postgres:16-alpine (musl) to pgvector/pgvector
-- (Debian, glibc) for V61. Both name the locale en_US.utf8, but musl compares
-- strings byte by byte and glibc does not, so every btree index on a text
-- column built under musl is out of order under glibc (amcheck: "item order
-- invariant violated"), and lookups through it can miss rows. Rebuilding them
-- is enough: the on-disk format is the same PG16 one. On a database created
-- under glibc this is a cheap no-op rebuild.
--
-- REINDEX SCHEMA cannot run in a transaction, REINDEX INDEX can; Flyway's own
-- history table is left alone.
DO $$
DECLARE
    idx record;
BEGIN
    FOR idx IN
        SELECT n.nspname AS schema_name, c.relname AS index_name
        FROM pg_index i
        JOIN pg_class c ON c.oid = i.indexrelid
        JOIN pg_class t ON t.oid = i.indrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname IN ('public', 'wiki')
          AND t.relname <> 'flyway_schema_history'
    LOOP
        EXECUTE format('REINDEX INDEX %I.%I', idx.schema_name, idx.index_name);
    END LOOP;
END $$;
