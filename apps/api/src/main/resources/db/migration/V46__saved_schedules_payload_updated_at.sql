-- When a saved schedule's payload last changed. updated_at also moves on
-- renames and primary toggles, which made a previous term's schedule look
-- current to the digest's "Tu cuatrimestre" staleness check
-- (service/digest/personal/DigestTerm). Set by SavedScheduleService only when
-- the payload actually changes; backfilled from updated_at (best known value).

ALTER TABLE "public"."saved_schedules"
    ADD COLUMN "payload_updated_at" TIMESTAMPTZ;

UPDATE "public"."saved_schedules" SET "payload_updated_at" = "updated_at";

ALTER TABLE "public"."saved_schedules"
    ALTER COLUMN "payload_updated_at" SET NOT NULL,
    ALTER COLUMN "payload_updated_at" SET DEFAULT now();
