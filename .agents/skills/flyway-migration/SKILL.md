---
name: flyway-migration
description: "Add a Flyway migration to apps/api. Use whenever the API schema or seed data changes: new table/column/index/constraint, data backfill, or a Drizzle table that needs a column."
---

# Add a Flyway migration

The SQL migrations are the only schema tool. `apps/api/src/db/migrate.ts` applies them on boot, Flyway-compatibly
(same `flyway_schema_history`, checksums and version order), and `src/db/schema/*.ts` is the Drizzle mapping
generated from a migrated database. The tests stop at the test mirrors (`V4.x`), which is the step people forget.

Paths (under `apps/api/src`; Flyway's old classpath directories, kept because merged migrations never move):

- prod: `main/resources/db/migration/V<N>__<snake_desc>.sql`
- test mirrors: `test/resources/db/test-migration/V4.<n>__<snake_desc>.sql` + its `README.md` table
- test target: `IT_FLYWAY_TARGET` in `apps/api/contract/support/pg.ts` (the contract suite and the in-process tests)

## Steps

1. **Pick versions.** `N` = highest integer prod version + 1 (gaps such as V43 are fine, never reuse one). `n` =
   highest `V4.<n>` mirror + 1. Versions compare per segment, so `4.10` sorts after `4.9`.
2. **Write the prod migration** `V<N>__<desc>.sql`. Name tables/columns in `snake_case`; schema-qualify `wiki.`
   tables. Never edit or rename a migration that already exists on `dev` or `main`: fix forward with a new one.
   **Expand/contract** (`apps/api/docs/DEPLOY.md`): during a deploy the old image keeps serving against the new
   schema. Additive changes (new table, nullable or defaulted column, index, new value old code ignores) ship with
   the code that uses them. `DROP`, `RENAME`, `NOT NULL` on an existing column and type changes ship one release
   later, when no deployed code uses the old shape (a rename = add, backfill, switch code, then drop). Big indexes on
   hot tables: `CREATE INDEX CONCURRENTLY`, so the serving color isn't blocked.
3. **Classify it.** DDL = any `CREATE`, `ALTER`, `DROP`, `RENAME` or `COMMENT ON`. Pure seed/backfill
   (`INSERT`/`UPDATE`/`DELETE` only) → skip to step 7.
4. **Mirror the DDL** as `V4.<n>__<same desc>.sql`: copy the DDL statements only, no seeds or `INSERT`s.
5. **Register the mirror**: add `| V4.<n> <desc> | V<N> |` to the README table and set
   `IT_FLYWAY_TARGET = '4.<n>'`.
6. **Regenerate the Drizzle schema** (if a table or column changed): migrate a scratch database with every prod
   migration (`DATABASE_URL=... bun src/db/migrate.ts migrate` from `apps/api`), then
   `DRIZZLE_DB_URL=<that database> bun run db:schema`. Never hand-edit `src/db/schema/`. `text[]` columns are
   arrays; `TIME` columns stay strings (`mode: 'string'`).
7. **Verify** from `apps/api`: `bun run build`, `bun run test` (includes `test/db/migrate.test.ts`) and the contract
   files touching the table (`bun contract/run.ts <fragment>`). `node scripts/checks/migrations.mjs` (repo root)
   checks steps 1–5.

Done when: the prod file exists, DDL has a registered mirror with the bumped target, the Drizzle schema matches,
and the tests are green.

Then hand the diff to the `migration-reviewer` subagent.
