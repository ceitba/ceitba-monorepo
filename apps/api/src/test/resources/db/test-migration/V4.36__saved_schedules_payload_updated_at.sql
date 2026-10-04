-- Mirror of prod V46. DDL-only (the backfill UPDATE is irrelevant on an empty table).

ALTER TABLE "public"."saved_schedules"
    ADD COLUMN "payload_updated_at" TIMESTAMPTZ NOT NULL DEFAULT now();
