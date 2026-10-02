-- Mirrors prod V30 (DDL-only). Tests cap Flyway at target=4.x.
CREATE TABLE "public"."schedule_correction" (
    "id"                UUID          NOT NULL DEFAULT gen_random_uuid(),
    "commission_id"     VARCHAR(20)   NOT NULL,
    "suggester_id"      UUID,
    "proposed_slots"    JSONB         NOT NULL,
    "sga_snapshot"      JSONB         NOT NULL,
    "slots_key"         TEXT          NOT NULL,
    "status"            VARCHAR(16)   NOT NULL DEFAULT 'PENDING',
    "confirm_count"     INTEGER       NOT NULL DEFAULT 0,
    "reject_count"      INTEGER       NOT NULL DEFAULT 0,
    "created_at"        TIMESTAMPTZ   NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"        TIMESTAMPTZ   NOT NULL DEFAULT CURRENT_TIMESTAMP,
    -- First time it became APPLIED (drives the one-time notification).
    "applied_at"        TIMESTAMPTZ,
    -- Last STAFF apply/reject.
    "reviewed_at"       TIMESTAMPTZ,
    "reviewed_by"       UUID,
    "reviewed_by_staff" BOOLEAN       NOT NULL DEFAULT FALSE,
    -- The suggester dismissed the "your correction was applied" notice.
    "seen_at"           TIMESTAMPTZ,
    CONSTRAINT "schedule_correction_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "schedule_correction_commission_id_fkey"
        FOREIGN KEY ("commission_id") REFERENCES "public"."commission" ("id") ON DELETE CASCADE,
    CONSTRAINT "schedule_correction_suggester_id_fkey"
        FOREIGN KEY ("suggester_id") REFERENCES "public"."user" ("id") ON DELETE SET NULL,
    CONSTRAINT "schedule_correction_reviewed_by_fkey"
        FOREIGN KEY ("reviewed_by") REFERENCES "public"."user" ("id") ON DELETE SET NULL,
    CONSTRAINT "schedule_correction_status_check" CHECK ("status" IN
        ('PENDING', 'APPLIED', 'REJECTED', 'RESOLVED', 'SUPERSEDED')),
    CONSTRAINT "schedule_correction_counts_non_negative"
        CHECK ("confirm_count" >= 0 AND "reject_count" >= 0)
);

-- Overlay for GET /v1/subjects and /v1/commissions: open corrections of a
-- set of commissions.
CREATE INDEX "schedule_correction_commission_status_idx"
    ON "public"."schedule_correction" ("commission_id", "status");
-- "My corrections", newest first.
CREATE INDEX "schedule_correction_suggester_created_idx"
    ON "public"."schedule_correction" ("suggester_id", "created_at" DESC);
-- Staff queue by status, newest first.
CREATE INDEX "schedule_correction_status_created_idx"
    ON "public"."schedule_correction" ("status", "created_at" DESC);
-- At most one applied correction per commission.
CREATE UNIQUE INDEX "schedule_correction_one_applied_idx"
    ON "public"."schedule_correction" ("commission_id") WHERE "status" = 'APPLIED';
-- No two open corrections with the same proposed slot set.
CREATE UNIQUE INDEX "schedule_correction_open_slots_idx"
    ON "public"."schedule_correction" ("commission_id", "slots_key")
    WHERE "status" IN ('PENDING', 'APPLIED');

CREATE TABLE "public"."schedule_correction_vote" (
    "correction_id" UUID        NOT NULL,
    "user_id"       UUID        NOT NULL,
    "type"          VARCHAR(8)  NOT NULL,
    "created_at"    TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"    TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "schedule_correction_vote_pkey" PRIMARY KEY ("correction_id", "user_id"),
    CONSTRAINT "schedule_correction_vote_correction_id_fkey"
        FOREIGN KEY ("correction_id") REFERENCES "public"."schedule_correction" ("id") ON DELETE CASCADE,
    CONSTRAINT "schedule_correction_vote_user_id_fkey"
        FOREIGN KEY ("user_id") REFERENCES "public"."user" ("id") ON DELETE CASCADE,
    CONSTRAINT "schedule_correction_vote_type_check" CHECK ("type" IN ('CONFIRM', 'REJECT'))
);

-- The caller's votes on a batch of corrections (my_vote overlay).
CREATE INDEX "schedule_correction_vote_user_idx"
    ON "public"."schedule_correction_vote" ("user_id", "correction_id");
