-- Test mirror of db/migration/V33__subject_wiki.sql (DDL only; see README.md).
-- Subject wikis (docs/SUBJECT-WIKI.md): Markdown pages per subject, written
-- from the published Drive files ("Apuntes") and cross-linked between
-- subjects. Phase 1 imports them through POST /v1/staff/kb/subjects/{id}/import.

-- One page per (subject, slug). REMOVED pages (dropped by a `replace` import)
-- keep their row so a later import of the same slug revives them.
CREATE TABLE "wiki"."kb_page" (
    "id"           UUID         NOT NULL DEFAULT gen_random_uuid(),
    "subject_id"   VARCHAR(25)  NOT NULL,
    "slug"         VARCHAR(128) NOT NULL,
    "type"         VARCHAR(16)  NOT NULL,
    "title"        TEXT         NOT NULL,
    "summary"      TEXT         NOT NULL,
    "aliases"      TEXT[]       NOT NULL DEFAULT '{}',
    "markdown"     TEXT         NOT NULL,
    -- drive_file ids the page draws on (no FK: files are purged, the page stays).
    "sources"      UUID[]       NOT NULL DEFAULT '{}',
    "revision"     INTEGER      NOT NULL DEFAULT 1,
    "generator"    VARCHAR(128) NOT NULL,
    "generated_at" TIMESTAMPTZ  NOT NULL,
    "status"       VARCHAR(16)  NOT NULL DEFAULT 'PUBLISHED',
    "report_count" INTEGER      NOT NULL DEFAULT 0,
    "created_at"   TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"   TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "kb_page_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "kb_page_subject_id_fkey"
        FOREIGN KEY ("subject_id") REFERENCES "public"."subject" ("id") ON DELETE CASCADE,
    CONSTRAINT "kb_page_type_check" CHECK ("type" IN ('INDEX', 'TOPIC', 'CONCEPT')),
    CONSTRAINT "kb_page_status_check" CHECK ("status" IN ('PUBLISHED', 'HIDDEN', 'REMOVED')),
    CONSTRAINT "kb_page_report_count_non_negative" CHECK ("report_count" >= 0)
);

CREATE UNIQUE INDEX "kb_page_subject_slug_idx" ON "wiki"."kb_page" ("subject_id", "slug");
CREATE INDEX "kb_page_status_updated_idx" ON "wiki"."kb_page" ("status", "updated_at" DESC);
-- Takedown: pages citing a file.
CREATE INDEX "kb_page_sources_idx" ON "wiki"."kb_page" USING GIN ("sources");

-- Previous versions of a page (the row before each changing import).
CREATE TABLE "wiki"."kb_page_revision" (
    "id"           UUID         NOT NULL DEFAULT gen_random_uuid(),
    "page_id"      UUID         NOT NULL,
    "revision"     INTEGER      NOT NULL,
    "type"         VARCHAR(16)  NOT NULL,
    "title"        TEXT         NOT NULL,
    "summary"      TEXT         NOT NULL,
    "aliases"      TEXT[]       NOT NULL DEFAULT '{}',
    "markdown"     TEXT         NOT NULL,
    "sources"      UUID[]       NOT NULL DEFAULT '{}',
    "generator"    VARCHAR(128) NOT NULL,
    "generated_at" TIMESTAMPTZ  NOT NULL,
    "created_at"   TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "kb_page_revision_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "kb_page_revision_page_id_fkey"
        FOREIGN KEY ("page_id") REFERENCES "wiki"."kb_page" ("id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX "kb_page_revision_page_revision_idx" ON "wiki"."kb_page_revision" ("page_id", "revision");

-- Wikilinks of a page's body, one per distinct target. to_page_id is NULL
-- until the target page exists (resolved after every import).
CREATE TABLE "wiki"."kb_link" (
    "id"            UUID         NOT NULL DEFAULT gen_random_uuid(),
    "from_page_id"  UUID         NOT NULL,
    "raw"           VARCHAR(256) NOT NULL,
    "to_subject_id" VARCHAR(25)  NOT NULL,
    "to_slug"       VARCHAR(128) NOT NULL,
    "to_page_id"    UUID,
    CONSTRAINT "kb_link_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "kb_link_from_page_id_fkey"
        FOREIGN KEY ("from_page_id") REFERENCES "wiki"."kb_page" ("id") ON DELETE CASCADE,
    CONSTRAINT "kb_link_to_page_id_fkey"
        FOREIGN KEY ("to_page_id") REFERENCES "wiki"."kb_page" ("id") ON DELETE SET NULL
);

CREATE UNIQUE INDEX "kb_link_from_raw_idx" ON "wiki"."kb_link" ("from_page_id", "raw");
CREATE INDEX "kb_link_target_idx" ON "wiki"."kb_link" ("to_subject_id", "to_slug");
CREATE INDEX "kb_link_to_page_idx" ON "wiki"."kb_link" ("to_page_id");

CREATE TABLE "wiki"."kb_page_report" (
    "page_id"    UUID        NOT NULL,
    "user_id"    UUID        NOT NULL,
    "reason"     VARCHAR(16) NOT NULL,
    "comment"    TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "kb_page_report_pkey" PRIMARY KEY ("page_id", "user_id"),
    CONSTRAINT "kb_page_report_page_id_fkey"
        FOREIGN KEY ("page_id") REFERENCES "wiki"."kb_page" ("id") ON DELETE CASCADE,
    CONSTRAINT "kb_page_report_user_id_fkey"
        FOREIGN KEY ("user_id") REFERENCES "public"."user" ("id") ON DELETE CASCADE,
    CONSTRAINT "kb_page_report_reason_check" CHECK ("reason" IN
        ('CONTENT_ERROR', 'COPYRIGHT', 'PERSONAL_DATA', 'SPAM', 'OTHER'))
);

CREATE INDEX "kb_page_report_user_idx" ON "wiki"."kb_page_report" ("user_id");

-- Related subjects. PREREQUISITE/DEPENDENT come from plan_subject.dependencies
-- across all plans (weight = number of plans), recomputed on startup and
-- nightly (KbRelationRefresher). LINKED is derived from kb_link at read time.
CREATE TABLE "wiki"."kb_subject_relation" (
    "subject_id" VARCHAR(25) NOT NULL,
    "related_id" VARCHAR(25) NOT NULL,
    "reason"     VARCHAR(16) NOT NULL,
    "weight"     INTEGER     NOT NULL DEFAULT 1,
    CONSTRAINT "kb_subject_relation_pkey" PRIMARY KEY ("subject_id", "related_id", "reason"),
    CONSTRAINT "kb_subject_relation_subject_id_fkey"
        FOREIGN KEY ("subject_id") REFERENCES "public"."subject" ("id") ON DELETE CASCADE,
    CONSTRAINT "kb_subject_relation_related_id_fkey"
        FOREIGN KEY ("related_id") REFERENCES "public"."subject" ("id") ON DELETE CASCADE,
    CONSTRAINT "kb_subject_relation_reason_check" CHECK ("reason" IN ('PREREQUISITE', 'DEPENDENT', 'LINKED'))
);

-- Generation runs of the phase-2 pipeline (not used yet).
CREATE TABLE "wiki"."kb_run" (
    "id"          UUID         NOT NULL DEFAULT gen_random_uuid(),
    "subject_id"  VARCHAR(25),
    "status"      VARCHAR(16)  NOT NULL,
    "generator"   VARCHAR(128),
    "stats"       JSONB        NOT NULL DEFAULT '{}'::jsonb,
    "error"       TEXT,
    "started_at"  TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMPTZ,
    CONSTRAINT "kb_run_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "kb_run_subject_id_fkey"
        FOREIGN KEY ("subject_id") REFERENCES "public"."subject" ("id") ON DELETE SET NULL,
    CONSTRAINT "kb_run_status_check" CHECK ("status" IN ('RUNNING', 'SUCCEEDED', 'FAILED'))
);
