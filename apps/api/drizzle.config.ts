import { defineConfig } from 'drizzle-kit';

// Drizzle never generates DDL here: Flyway SQL in apps/api owns the schema.
// `bunx drizzle-kit pull` re-introspects src/db/schema/ from a database
// migrated with ALL production migrations (bun src/db/migrate.ts):
//   DRIZZLE_DB_URL=postgres://postgres:postgres@localhost:55432/tsprod bunx drizzle-kit pull
// then run `bun scripts/split-schema.ts` to split the output per area.
export default defineConfig({
  dialect: 'postgresql',
  out: './drizzle-introspect',
  schemaFilter: ['public', 'wiki'],
  tablesFilter: ['!flyway_schema_history'],
  dbCredentials: { url: process.env.DRIZZLE_DB_URL ?? 'postgres://postgres:postgres@localhost:5432/ceitba_db' },
  introspect: { casing: 'camel' },
});
