---
name: flyway-migration
description: "Add a Flyway migration to apps/api. Use whenever the API schema or seed data changes: new table/column/index/constraint, data backfill, or an entity mapping that needs a column."
---

# Add a Flyway migration

Flyway is the only schema tool; Hibernate runs in `validate` mode, so entity and schema must agree in prod **and**
in the integration tests. ITs stop at the test mirrors (`V4.x`), which is the step people forget.

Paths (under `apps/api/src`):

- prod: `main/resources/db/migration/V<N>__<snake_desc>.sql`
- test mirrors: `test/resources/db/test-migration/V4.<n>__<snake_desc>.sql` + its `README.md` table
- test target: `test/resources/application.yml` → `spring.flyway.target` and the comment list above it

## Steps

1. **Pick versions.** `N` = highest integer prod version + 1 (gaps such as V43 are fine, never reuse one). `n` =
   highest `V4.<n>` mirror + 1. Flyway compares per segment, so `4.10` sorts after `4.9`.
2. **Write the prod migration** `V<N>__<desc>.sql`. Name tables/columns in `snake_case`; schema-qualify `wiki.`
   tables. Never edit or rename a migration that already exists on `dev` or `main`: fix forward with a new one.
3. **Classify it.** DDL = any `CREATE`, `ALTER`, `DROP`, `RENAME` or `COMMENT ON`. Pure seed/backfill
   (`INSERT`/`UPDATE`/`DELETE` only) → skip to step 6.
4. **Mirror the DDL** as `V4.<n>__<same desc>.sql`: copy the DDL statements only, no seeds or `INSERT`s.
5. **Register the mirror**: add `| V4.<n> <desc> | V<N> |` to the README table, set `target: '4.<n>'` in the test
   `application.yml`, and append `V<N>` to the list in the comment above it.
6. **Map the entity** (if any) in `domain/` to match the schema exactly: column names, nullability, lengths,
   `String[]` (not `List<String>`) for `text[]` columns (see `ListStringMappingOrderIT`), `@IdClass` for composite
   keys.
7. **Verify**: `./mvnw -B -ntp verify` from `apps/api` (or at least the ITs touching the entity plus
   `ProdMigrationsIT` and `SchemaValidationIT`). `node scripts/checks/migrations.mjs` checks steps 1–5 when present.

Done when: the prod file exists, DDL has a registered mirror with the bumped target, and `verify` is green.

Then hand the diff to the `migration-reviewer` subagent.
