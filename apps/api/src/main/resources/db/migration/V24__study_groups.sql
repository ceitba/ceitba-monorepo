-- Student study groups (replaces the mobile app's Firestore `StudyGroups`
-- collection; no data is imported, groups start fresh).
--
-- * type and locations are fixed vocabularies checked here and mirrored by
--   Java enums (StudyGroupType, StudyGroupLocation).
-- * max_participants counts every member including the owner; NULL means
--   unlimited. Capacity is enforced in the service under a row lock on the
--   group (SELECT ... FOR UPDATE), not by a trigger.
-- * contact_link is only returned to members.
-- * Owner leaves: the group is deleted when the owner is its only member,
--   otherwise ownership passes to the earliest remaining joiner. Deleting the
--   owner's account deletes their groups (ON DELETE CASCADE).
CREATE TABLE "public"."study_groups" (
    "id"               UUID          NOT NULL DEFAULT gen_random_uuid(),
    "owner_id"         UUID          NOT NULL,
    "title"            VARCHAR(120)  NOT NULL,
    "subject_id"       VARCHAR(25)   NOT NULL,
    "type"             VARCHAR(16)   NOT NULL,
    "locations"        TEXT[]        NOT NULL,
    "due_at"           TIMESTAMPTZ   NOT NULL,
    "description"      VARCHAR(2000),
    "contact_link"     VARCHAR(2048),
    "max_participants" INTEGER,
    "created_at"       TIMESTAMPTZ   NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"       TIMESTAMPTZ   NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "study_groups_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "study_groups_owner_id_fkey"
        FOREIGN KEY ("owner_id") REFERENCES "public"."user" ("id") ON DELETE CASCADE,
    CONSTRAINT "study_groups_subject_id_fkey"
        FOREIGN KEY ("subject_id") REFERENCES "public"."subject" ("id") ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT "study_groups_type_check"
        CHECK ("type" IN ('TP_GRUPO', 'AHORA', 'EXAMEN', 'GUIAS')),
    CONSTRAINT "study_groups_locations_check"
        CHECK (cardinality("locations") >= 1
               AND "locations" <@ ARRAY['VIRTUAL', 'SDR', 'SDT', 'SDF']::TEXT[]),
    CONSTRAINT "study_groups_max_participants_check"
        CHECK ("max_participants" IS NULL OR "max_participants" >= 1)
);

-- List queries filter on upcoming groups and optionally subject.
CREATE INDEX "study_groups_due_at_idx" ON "public"."study_groups" ("due_at");
CREATE INDEX "study_groups_subject_due_at_idx" ON "public"."study_groups" ("subject_id", "due_at");

CREATE TABLE "public"."study_group_participants" (
    "group_id"  UUID        NOT NULL,
    "user_id"   UUID        NOT NULL,
    "joined_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "study_group_participants_pkey" PRIMARY KEY ("group_id", "user_id"),
    CONSTRAINT "study_group_participants_group_id_fkey"
        FOREIGN KEY ("group_id") REFERENCES "public"."study_groups" ("id") ON DELETE CASCADE,
    CONSTRAINT "study_group_participants_user_id_fkey"
        FOREIGN KEY ("user_id") REFERENCES "public"."user" ("id") ON DELETE CASCADE
);

-- GET /v1/me/study-groups.
CREATE INDEX "study_group_participants_user_id_idx"
    ON "public"."study_group_participants" ("user_id");
