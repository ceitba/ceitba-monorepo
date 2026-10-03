-- Sources without an owning student (COMMUNITY), a per-source storage mode
-- and the resumable walk (docs/DRIVE-SYNC.md).
--
-- kind: STUDENT (a student's folder, user_id set), COMMUNITY_ROOT (an archive
-- whose top-level folders become one COMMUNITY source each; never walked
-- itself) and COMMUNITY (one such folder, parent_source_id = the root).
-- owner_email: the Drive owner of a community archive (shortcuts are only
-- followed to items it owns); never exposed by the API.
-- subject_id: the subject every file of a community source counts for.
-- storage_mode: COPY (binaries stored in MinIO) or REFERENCE (only text and
-- Docs' HTML are kept; downloads stream from Drive on request).
ALTER TABLE "wiki"."drive_source" ALTER COLUMN "user_id" DROP NOT NULL;
ALTER TABLE "wiki"."drive_source"
    ADD COLUMN "kind"             VARCHAR(16) NOT NULL DEFAULT 'STUDENT',
    ADD COLUMN "display_name"     TEXT,
    ADD COLUMN "storage_mode"     VARCHAR(16) NOT NULL DEFAULT 'COPY',
    ADD COLUMN "subject_id"       VARCHAR(25),
    ADD COLUMN "parent_source_id" UUID,
    ADD COLUMN "owner_email"      VARCHAR(320),
    ADD CONSTRAINT "drive_source_kind_check" CHECK ("kind" IN ('STUDENT', 'COMMUNITY_ROOT', 'COMMUNITY')),
    ADD CONSTRAINT "drive_source_storage_mode_check" CHECK ("storage_mode" IN ('COPY', 'REFERENCE')),
    ADD CONSTRAINT "drive_source_owner_check" CHECK (("kind" = 'STUDENT') = ("user_id" IS NOT NULL)),
    ADD CONSTRAINT "drive_source_subject_id_fkey"
        FOREIGN KEY ("subject_id") REFERENCES "public"."subject" ("id") ON DELETE SET NULL,
    ADD CONSTRAINT "drive_source_parent_fkey"
        FOREIGN KEY ("parent_source_id") REFERENCES "wiki"."drive_source" ("id") ON DELETE CASCADE;

CREATE UNIQUE INDEX "drive_source_community_child_uq"
    ON "wiki"."drive_source" ("parent_source_id", "root_folder_id") WHERE "parent_source_id" IS NOT NULL;
CREATE UNIQUE INDEX "drive_source_community_root_uq"
    ON "wiki"."drive_source" ("root_folder_id") WHERE "kind" = 'COMMUNITY_ROOT';

-- The resumable walk of a source: one generation at a time. frontier holds
-- the folders still to list ("<depth>/<drive id>"); a run continues from it.
-- Items seen in the generation get drive_file.seen_generation; only when the
-- frontier is empty (completed_at set) and nothing went wrong (incomplete
-- false) are rows not seen in it treated as removed. root_ancestors: the
-- Drive folders above the source's root (shortcuts to them are never followed).
CREATE TABLE "wiki"."drive_source_walk" (
    "source_id"      UUID        NOT NULL,
    "generation"     BIGINT      NOT NULL,
    "started_at"     TIMESTAMPTZ NOT NULL,
    "completed_at"   TIMESTAMPTZ,
    "frontier"       JSONB       NOT NULL DEFAULT '[]'::jsonb,
    "root_ancestors" JSONB       NOT NULL DEFAULT '[]'::jsonb,
    "incomplete"     BOOLEAN     NOT NULL DEFAULT FALSE,
    "warning"        TEXT,
    "updated_at"     TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "drive_source_walk_pkey" PRIMARY KEY ("source_id"),
    CONSTRAINT "drive_source_walk_source_fkey"
        FOREIGN KEY ("source_id") REFERENCES "wiki"."drive_source" ("id") ON DELETE CASCADE
);

-- seen_generation: the last walk generation that reached the item.
-- by_reference: the row's content is not stored (REFERENCE mode or a file
-- above DRIVE_SYNC_REFERENCE_ABOVE_BYTES); downloads stream from Drive.
ALTER TABLE "wiki"."drive_file"
    ADD COLUMN "seen_generation" BIGINT,
    ADD COLUMN "by_reference"    BOOLEAN NOT NULL DEFAULT FALSE;
CREATE INDEX "drive_file_source_seen_idx" ON "wiki"."drive_file" ("source_id", "seen_generation");

-- The community archive "1-Materias" (owned by one Gmail account outside
-- ITBA): trusted, published without review, stored by reference. Each
-- top-level folder "<code> - <name>" becomes a COMMUNITY source on the next
-- sync run (DriveCommunityService).
INSERT INTO "wiki"."drive_source" ("kind", "user_id", "root_folder_id", "root_name", "display_name", "status",
                                   "anonymous", "consent_version", "consented_at", "approved_at", "storage_mode")
VALUES ('COMMUNITY_ROOT', NULL, '1V3b2mlgCODmHaUh4WbvuHa4_POyvJvd1', '1-Materias', 'Comunidad', 'ACTIVE',
        FALSE, 'community', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 'REFERENCE')
ON CONFLICT DO NOTHING;
