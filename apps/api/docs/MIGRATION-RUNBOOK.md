# Migration Runbook — NestJS → Spring Boot

Operational steps for cutover. Read MIGRATION.md for the architectural plan.

## Prerequisites

- JDK 21 (Eclipse Temurin recommended).
- PostgreSQL 14+ matching the production version.
- The Spring Boot artifact (JAR) built from the `migration/spring-boot` branch.

## One-time prod setup (before first Spring Boot deploy)

The production DB has been managed by Prisma to date. The `_prisma_migrations`
table tracks applied migrations. We need Flyway to take over without re-running
any of them.

1. **Verify the prod schema matches `V1__baseline.sql`**:
   ```sh
   pg_dump --schema-only --no-owner --no-privileges -h $PROD_HOST -U $PROD_USER $PROD_DB > prod-schema.sql
   diff <(sort src/main/resources/db/migration/V1__baseline.sql) <(sort prod-schema.sql)
   ```
   The only difference should be the `user.career_id` type (UUID in prod, VARCHAR(25) in baseline) and the missing FK. Apply the fix as a one-shot manual step:
   ```sql
   BEGIN;
   UPDATE public."user" SET career_id = NULL
     WHERE career_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM public.careers c WHERE c.id::text = career_id::text);
   ALTER TABLE public."user" ALTER COLUMN career_id TYPE VARCHAR(25) USING career_id::text;
   ALTER TABLE public."user" ADD CONSTRAINT user_career_id_fkey
     FOREIGN KEY (career_id) REFERENCES public.careers(id)
     ON DELETE SET NULL ON UPDATE CASCADE;
   COMMIT;
   ```

2. **Baseline Flyway against the existing schema**:
   ```sh
   ./mvnw flyway:baseline \
     -Dflyway.url=jdbc:postgresql://$PROD_HOST:5432/$PROD_DB \
     -Dflyway.user=$PROD_USER \
     -Dflyway.password=$PROD_PASS \
     -Dflyway.baselineVersion=1 \
     -Dflyway.schemas=public,wiki
   ```
   This creates `flyway_schema_history` with version 1 marked as baseline. Future migrations (`V2__...`, `V3__...`) will be applied on top.

3. **Drop the Prisma history table** (after verifying everything works):
   ```sql
   DROP TABLE IF EXISTS public._prisma_migrations;
   ```
   Do this only after the cutover (PR 11 of MIGRATION.md) is complete and stable.

## Legacy Firestore app import (mobile app cut-over)

Run once, when the new mobile app replaces the Firestore-backed one. Details
in `scripts/firestore-export/README.md`.

1. **Prerequisites:** object storage configured on the API (`STORAGE_*`,
   MinIO; see `docs/OBJECT-STORAGE.md`), careers/plans loaded, the
   `convenios` benefit category (V21).
2. **Export with the attachment copy step** (cut-over prerequisite): run
   `node export.mjs --copy-attachments` with the API's `STORAGE_*` values. It
   copies every proposal attachment from Firebase Storage into the bucket
   (`proposals/legacy/…`) and writes the object keys into the export. The importer
   refuses raw Firebase Storage URLs (each is dropped with a warning), so no
   imported attachment depends on the legacy Firebase project, and Firebase
   Storage can be retired right after the import. The script exits non-zero
   if any attachment could not be copied: fix and re-run it before importing.
3. **Dry-run, read the report, import.** Keep the content-hash root secret
   unchanged between import runs (`CONTENT_HMAC_SECRET`, or `AUTH_JWT_SECRET`
   when that is unset): imported comment ids are keyed on it, and a re-run
   under a rotated secret would duplicate every legacy comment.
4. Delete the export file (it holds personal data).

## Local dev setup

```sh
docker compose up postgres -d
./mvnw spring-boot:run
```

Flyway runs `V1__baseline.sql` automatically on first boot against an empty DB.

## Rollback (if cutover fails before PR 11)

Until PR 11 lands, the NestJS app on `main` is still authoritative. To roll back:

1. Point the reverse proxy entirely back at NestJS.
2. Stop the Spring Boot deployment.
3. The schema baseline does not need to be reverted — Prisma can continue to manage it (the `career_id` fix in step 1 is forward-compatible with the Prisma schema once you update `prisma/schema.prisma` to match).
