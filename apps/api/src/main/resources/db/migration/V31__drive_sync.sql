-- Drive sync ("Apuntes"): students share a Google Drive folder with the
-- CEITBA bot service account; the API copies it into object storage and
-- serves the files per subject. See docs/DRIVE-SYNC.md.
--
-- Statuses are VARCHAR + CHECK (not PG enums) so adding a value is a plain
-- constraint swap. User references are plain UUID columns (entities map them
-- as UUID, never @ManyToOne); account deletion removes the rows explicitly
-- (AccountDeletionRepository) because an anonymized user row is kept.

-- A registered root folder.
CREATE TABLE "wiki"."drive_source" (
    "id"                   UUID         NOT NULL DEFAULT gen_random_uuid(),
    "user_id"              UUID         NOT NULL,
    "root_folder_id"       VARCHAR(128) NOT NULL,
    "root_name"            TEXT         NOT NULL,
    "status"               VARCHAR(16)  NOT NULL DEFAULT 'PENDING_REVIEW',
    "anonymous"            BOOLEAN      NOT NULL DEFAULT FALSE,
    "consent_version"      VARCHAR(32)  NOT NULL,
    "consented_at"         TIMESTAMPTZ  NOT NULL,
    -- First time the source became ACTIVE (staff approval or auto-trust);
    -- an ERROR source that was approved keeps publishing.
    "approved_at"          TIMESTAMPTZ,
    "reviewed_by"          UUID,
    "reviewed_at"          TIMESTAMPTZ,
    "review_comment"       TEXT,
    "last_synced_at"       TIMESTAMPTZ,
    -- Last manual POST .../sync (max once per 5 minutes).
    "last_sync_requested_at" TIMESTAMPTZ,
    "last_error"           TEXT,
    "consecutive_failures" INTEGER      NOT NULL DEFAULT 0,
    "created_at"           TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"           TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "drive_source_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "drive_source_user_id_fkey"
        FOREIGN KEY ("user_id") REFERENCES "public"."user" ("id") ON DELETE CASCADE,
    CONSTRAINT "drive_source_reviewed_by_fkey"
        FOREIGN KEY ("reviewed_by") REFERENCES "public"."user" ("id") ON DELETE SET NULL,
    CONSTRAINT "drive_source_status_check" CHECK ("status" IN
        ('PENDING_REVIEW', 'ACTIVE', 'BLOCKED', 'REVOKED', 'DISCONNECTED', 'ERROR')),
    CONSTRAINT "drive_source_failures_non_negative" CHECK ("consecutive_failures" >= 0)
);

-- One live registration of a folder per user (a disconnected one can be
-- registered again).
CREATE UNIQUE INDEX "drive_source_user_root_live_idx"
    ON "wiki"."drive_source" ("user_id", "root_folder_id") WHERE "status" <> 'DISCONNECTED';
-- The job's queue: oldest sync first.
CREATE INDEX "drive_source_status_synced_idx"
    ON "wiki"."drive_source" ("status", "last_synced_at" NULLS FIRST);
-- Unclaimed-share matching.
CREATE INDEX "drive_source_root_folder_idx" ON "wiki"."drive_source" ("root_folder_id");

-- Every item (folder or file) under a source's root, flat. parent_drive_id
-- is the Drive id of the containing folder, NULL for direct children of the
-- root. The row id is stable across renames and moves (also to another
-- source of the same student). Stored copies live under
-- drive/<drive_id>/<hash of content_fingerprint>/ and are shared by every row
-- with the same (drive_id, content_fingerprint). Binary files: md5Checksum
-- (downloaded only when it changes). Native Google files: a hash of the
-- exported content, re-exported when modifiedTime changes (renames bump it
-- too) but stored again only when the hash changes. drive_version is
-- informational.
CREATE TABLE "wiki"."drive_file" (
    "id"                    UUID          NOT NULL DEFAULT gen_random_uuid(),
    "source_id"             UUID          NOT NULL,
    "drive_id"              VARCHAR(128)  NOT NULL,
    "parent_drive_id"       VARCHAR(128),
    "name"                  TEXT          NOT NULL,
    "mime_type"             VARCHAR(255)  NOT NULL,
    "kind"                  VARCHAR(16)   NOT NULL,
    -- Drive owner of the item; owned_by_sharer = it is the source's student.
    "owner_email"           VARCHAR(320),
    "owned_by_sharer"       BOOLEAN       NOT NULL DEFAULT FALSE,
    "drive_version"         BIGINT,
    "md5_checksum"          VARCHAR(64),
    "size_bytes"            BIGINT,
    "drive_modified_at"     TIMESTAMPTZ,
    -- Student's own choice; effective = own, else nearest ancestor's.
    "subject_id"            VARCHAR(25),
    "effective_subject_id"  VARCHAR(25),
    "suggested_subject_id"  VARCHAR(25),
    "hidden"                BOOLEAN       NOT NULL DEFAULT FALSE,
    "publication"           VARCHAR(16)   NOT NULL DEFAULT 'PRIVATE',
    -- Sticky staff decision: PUBLISH or REMOVE (NULL = follow the rule).
    "staff_decision"        VARCHAR(8),
    "published_at"          TIMESTAMPTZ,
    "report_count"          INTEGER       NOT NULL DEFAULT 0,
    -- Stored copy: the fingerprint/version it was made from and its objects.
    "content_version"       BIGINT,
    "content_fingerprint"   VARCHAR(64),
    -- modifiedTime of a native Google file when its content was last checked
    -- (the cheap trigger to export and re-hash it).
    "content_modified_at"   TIMESTAMPTZ,
    "html_content"          TEXT,
    "pdf_key"               TEXT,
    "original_key"          TEXT,
    "original_content_type" VARCHAR(255),
    "asset_prefix"          TEXT,
    "asset_names"           JSONB         NOT NULL DEFAULT '[]'::jsonb,
    "text_content"          TEXT,
    "metadata_only"         BOOLEAN       NOT NULL DEFAULT FALSE,
    "sync_error"            TEXT,
    "removed_at"            TIMESTAMPTZ,
    "purge_after"           TIMESTAMPTZ,
    "created_at"            TIMESTAMPTZ   NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"            TIMESTAMPTZ   NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "drive_file_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "drive_file_source_id_fkey"
        FOREIGN KEY ("source_id") REFERENCES "wiki"."drive_source" ("id") ON DELETE CASCADE,
    CONSTRAINT "drive_file_subject_id_fkey"
        FOREIGN KEY ("subject_id") REFERENCES "public"."subject" ("id") ON DELETE SET NULL,
    CONSTRAINT "drive_file_effective_subject_id_fkey"
        FOREIGN KEY ("effective_subject_id") REFERENCES "public"."subject" ("id") ON DELETE SET NULL,
    CONSTRAINT "drive_file_suggested_subject_id_fkey"
        FOREIGN KEY ("suggested_subject_id") REFERENCES "public"."subject" ("id") ON DELETE SET NULL,
    CONSTRAINT "drive_file_kind_check" CHECK ("kind" IN
        ('FOLDER', 'DOC', 'SLIDES', 'SHEET', 'DRAWING', 'PDF', 'IMAGE', 'OFFICE', 'OTHER')),
    CONSTRAINT "drive_file_publication_check" CHECK ("publication" IN
        ('PRIVATE', 'NEEDS_REVIEW', 'PUBLISHED', 'HIDDEN_REPORTED', 'REMOVED_BY_STAFF', 'REMOVED')),
    CONSTRAINT "drive_file_staff_decision_check" CHECK ("staff_decision" IN ('PUBLISH', 'REMOVE')),
    CONSTRAINT "drive_file_report_count_non_negative" CHECK ("report_count" >= 0)
);

CREATE UNIQUE INDEX "drive_file_source_drive_idx" ON "wiki"."drive_file" ("source_id", "drive_id");
-- Cross-source moves and shared stored copies.
CREATE INDEX "drive_file_drive_fingerprint_idx" ON "wiki"."drive_file" ("drive_id", "content_fingerprint");
-- Reader: published files of a subject.
CREATE INDEX "drive_file_subject_publication_idx"
    ON "wiki"."drive_file" ("effective_subject_id", "publication");
-- Staff queues by publication.
CREATE INDEX "drive_file_publication_updated_idx"
    ON "wiki"."drive_file" ("publication", "updated_at" DESC);
-- Purge of files removed from Drive more than 30 days ago.
CREATE INDEX "drive_file_purge_after_idx"
    ON "wiki"."drive_file" ("purge_after") WHERE "purge_after" IS NOT NULL;

-- One report per user and file; drive_file.report_count is recounted from
-- these rows on every change.
CREATE TABLE "wiki"."drive_file_report" (
    "file_id"    UUID        NOT NULL,
    "user_id"    UUID        NOT NULL,
    "reason"     VARCHAR(16) NOT NULL,
    "comment"    TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "drive_file_report_pkey" PRIMARY KEY ("file_id", "user_id"),
    CONSTRAINT "drive_file_report_file_id_fkey"
        FOREIGN KEY ("file_id") REFERENCES "wiki"."drive_file" ("id") ON DELETE CASCADE,
    CONSTRAINT "drive_file_report_user_id_fkey"
        FOREIGN KEY ("user_id") REFERENCES "public"."user" ("id") ON DELETE CASCADE,
    CONSTRAINT "drive_file_report_reason_check" CHECK ("reason" IN
        ('COPYRIGHT', 'PERSONAL_DATA', 'WRONG_SUBJECT', 'SPAM', 'OTHER'))
);

CREATE INDEX "drive_file_report_user_idx" ON "wiki"."drive_file_report" ("user_id");

-- Folders shared with the bot that nobody registered (staff can follow up).
CREATE TABLE "wiki"."drive_unclaimed_share" (
    "drive_id"      VARCHAR(128) NOT NULL,
    "name"          TEXT         NOT NULL,
    "owner_email"   VARCHAR(320),
    "first_seen_at" TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at"  TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "drive_unclaimed_share_pkey" PRIMARY KEY ("drive_id")
);
