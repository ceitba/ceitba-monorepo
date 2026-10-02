-- Student-suggested schedule corrections ("el horario del SGA está mal").
-- A logged-in student proposes the real day/time slots of a commission;
-- other students confirm or reject; at 3 confirms (and more confirms than
-- rejects) the correction is APPLIED and its slots replace the SGA ones
-- wherever the API serves commission times for scheduling. STAFF can apply
-- or reject any open correction. See docs/SCHEDULE-CORRECTIONS.md.
--
-- Requires V29 (PR #41) to be applied first only by Flyway ordering; there
-- is no schema dependency on it.
--
-- Slots are JSONB arrays of {"day": "TUESDAY", "from": "08:00", "to": "11:00"}
-- (rooms are not editable in v1). `slots_key` is the canonical text form of
-- the normalized proposed set, used to find an identical open suggestion.
-- `sga_snapshot` is the commission's SGA slot set when the correction was
-- created; the sync expires open corrections once the SGA slots change.
--
-- Status: PENDING -> APPLIED (votes or staff) -> PENDING (votes fall below
-- the rule) ; PENDING|APPLIED -> REJECTED (staff), RESOLVED (SGA now equals
-- the proposal), SUPERSEDED (another correction applied, or SGA changed).
--
-- The suggester is never exposed by any response (anonymity is absolute);
-- suggester_id only drives "my corrections" and the applied notification.
-- Counters are maintained under a row lock on the parent commission (see
-- ScheduleCorrectionService), recomputed from the vote rows on every change.

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
