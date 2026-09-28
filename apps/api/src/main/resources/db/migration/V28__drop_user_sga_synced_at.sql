-- The SGA academic prefill (V18 added this column for it) is gone: ITBA
-- revoked CEITBA's access to the SGA student lookup in 2026-09, so nothing
-- writes or reads user.sga_synced_at any more.
ALTER TABLE "public"."user"
    DROP COLUMN IF EXISTS "sga_synced_at";
