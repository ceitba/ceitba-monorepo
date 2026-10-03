-- Test mirror of db/migration/V35__wiki_pipeline.sql (DDL plus the kb_model
-- catalog seed, which no test counts; see README.md).
-- Subject wiki self-update pipeline (docs/SUBJECT-WIKI-PIPELINE.md): weekly,
-- change-driven regeneration through DigitalOcean batch inference.

-- Why a page is HIDDEN: STAFF (hide endpoint), REPORTS (3 reports) or
-- TAKEDOWN (a cited file was removed by staff / its source blocked). The
-- pipeline republishes TAKEDOWN pages it rewrote without the removed source.
ALTER TABLE "wiki"."kb_page" ADD COLUMN "hidden_reason" VARCHAR(16),
    ADD CONSTRAINT "kb_page_hidden_reason_check" CHECK ("hidden_reason" IN ('STAFF', 'REPORTS', 'TAKEDOWN'));

-- kb_run (V33) becomes the pipeline run.
ALTER TABLE "wiki"."kb_run" DROP CONSTRAINT "kb_run_status_check";
ALTER TABLE "wiki"."kb_run"
    ADD COLUMN "trigger"        VARCHAR(16)  NOT NULL DEFAULT 'MANUAL',
    ADD COLUMN "stage"          VARCHAR(16),
    ADD COLUMN "dry_run"        BOOLEAN      NOT NULL DEFAULT FALSE,
    ADD COLUMN "prompt_version" VARCHAR(16),
    ADD COLUMN "model"          VARCHAR(128),
    ADD COLUMN "subjects"       JSONB        NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN "tokens_in"      BIGINT       NOT NULL DEFAULT 0,
    ADD COLUMN "tokens_out"     BIGINT       NOT NULL DEFAULT 0,
    ADD COLUMN "tokens_cached"  BIGINT       NOT NULL DEFAULT 0,
    ADD COLUMN "estimated_tokens" BIGINT     NOT NULL DEFAULT 0,
    ADD COLUMN "cost_estimate"  NUMERIC(12, 4),
    ADD COLUMN "updated_at"     TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ADD COLUMN "cost_approved"  BOOLEAN      NOT NULL DEFAULT FALSE,
    -- The forecast of the run when it was detected (vs cost_estimate, the actual).
    ADD COLUMN "expected_cost_usd" NUMERIC(12, 4),
    ADD COLUMN "simulated"      BOOLEAN      NOT NULL DEFAULT FALSE,
    ADD CONSTRAINT "kb_run_trigger_check" CHECK ("trigger" IN ('SCHEDULED', 'MANUAL', 'EVAL'));
ALTER TABLE "wiki"."kb_run" ALTER COLUMN "status" TYPE VARCHAR(32);
ALTER TABLE "wiki"."kb_run" ADD CONSTRAINT "kb_run_status_check" CHECK ("status" IN
    ('RUNNING', 'WAITING', 'BLOCKED_BY_COST_LIMIT', 'SUCCEEDED', 'FAILED', 'CANCELLED'));
-- One active pipeline run and one active eval at a time.
CREATE UNIQUE INDEX "kb_run_one_active_idx" ON "wiki"."kb_run" (("trigger" = 'EVAL'))
    WHERE "status" IN ('RUNNING', 'WAITING', 'BLOCKED_BY_COST_LIMIT');
CREATE INDEX "kb_run_started_idx" ON "wiki"."kb_run" ("started_at" DESC);

-- One execution per stage, model and attempt (attempt 2 resubmits what the
-- first left incomplete): a DO batch (mode BATCH) or a sequence of
-- synchronous chat completions (mode SYNC). Payloads, the same in both
-- modes: storage kb/runs/<runId>/<stage>[-<n>].jsonl.
CREATE TABLE "wiki"."kb_batch_job" (
    "id"                         UUID         NOT NULL DEFAULT gen_random_uuid(),
    "run_id"                     UUID         NOT NULL,
    "stage"                      VARCHAR(16)  NOT NULL,
    "attempt"                    INTEGER      NOT NULL DEFAULT 1,
    "model"                      VARCHAR(128) NOT NULL,
    "mode"                       VARCHAR(8)   NOT NULL DEFAULT 'BATCH',
    "do_batch_id"                VARCHAR(128),
    "do_file_id"                 VARCHAR(128),
    "status"                     VARCHAR(16)  NOT NULL,
    "request_count"              INTEGER      NOT NULL DEFAULT 0,
    "payload_key"                TEXT,
    "output_key"                 TEXT,
    "tokens_in"                  BIGINT       NOT NULL DEFAULT 0,
    "tokens_out"                 BIGINT       NOT NULL DEFAULT 0,
    "tokens_cached"              BIGINT       NOT NULL DEFAULT 0,
    "cost_estimate"              NUMERIC(12, 4),
    "submitted_at"               TIMESTAMPTZ,
    "completed_at"               TIMESTAMPTZ,
    "output_file_url_fetched_at" TIMESTAMPTZ,
    "error"                      TEXT,
    "created_at"                 TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "kb_batch_job_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "kb_batch_job_run_id_fkey"
        FOREIGN KEY ("run_id") REFERENCES "wiki"."kb_run" ("id") ON DELETE CASCADE,
    CONSTRAINT "kb_batch_job_status_check" CHECK ("status" IN
        ('DRY', 'SUBMITTED', 'COMPLETED', 'FAILED', 'CANCELLED')),
    CONSTRAINT "kb_batch_job_mode_check" CHECK ("mode" IN ('BATCH', 'SYNC'))
);
CREATE INDEX "kb_batch_job_run_idx" ON "wiki"."kb_batch_job" ("run_id", "stage");

-- Per-subject state of a run.
CREATE TABLE "wiki"."kb_run_subject" (
    "run_id"      UUID        NOT NULL,
    "subject_id"  VARCHAR(25) NOT NULL,
    "status"      VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    "model"       VARCHAR(128) NOT NULL,
    "priority"    BIGINT      NOT NULL DEFAULT 0,
    -- [{fileId, fingerprint, academicYear}] at DETECT; recorded as compiled on publish.
    "inputs"      JSONB       NOT NULL,
    "added"       JSONB       NOT NULL DEFAULT '[]'::jsonb,
    "changed"     JSONB       NOT NULL DEFAULT '[]'::jsonb,
    "removed"     JSONB       NOT NULL DEFAULT '[]'::jsonb,
    -- PLAN output (validated operations), drafts and the final outcome.
    "operations"  JSONB       NOT NULL DEFAULT '[]'::jsonb,
    "drafts"      JSONB       NOT NULL DEFAULT '{}'::jsonb,
    "accepted"    JSONB       NOT NULL DEFAULT '[]'::jsonb,
    "rejected"    JSONB       NOT NULL DEFAULT '[]'::jsonb,
    "deleted"     JSONB       NOT NULL DEFAULT '[]'::jsonb,
    "tokens_in"   BIGINT      NOT NULL DEFAULT 0,
    "tokens_out"  BIGINT      NOT NULL DEFAULT 0,
    "tokens_cached" BIGINT    NOT NULL DEFAULT 0,
    "cost_estimate" NUMERIC(12, 4) NOT NULL DEFAULT 0,
    "error"       TEXT,
    CONSTRAINT "kb_run_subject_pkey" PRIMARY KEY ("run_id", "subject_id"),
    CONSTRAINT "kb_run_subject_run_id_fkey"
        FOREIGN KEY ("run_id") REFERENCES "wiki"."kb_run" ("id") ON DELETE CASCADE,
    CONSTRAINT "kb_run_subject_status_check" CHECK ("status" IN
        ('PENDING', 'DEFERRED', 'FAILED', 'PUBLISHED', 'DRY', 'CANCELLED'))
);

-- One LLM request. custom_id is short (Anthropic batch ids allow
-- [A-Za-z0-9_-]{1,64}); item_key keeps <runId>:<stage>:<subjectId>:<slug|fileId>:<chunk>.
CREATE TABLE "wiki"."kb_run_request" (
    "custom_id"    VARCHAR(64)  NOT NULL,
    "run_id"       UUID         NOT NULL,
    "batch_job_id" UUID,
    "stage"        VARCHAR(16)  NOT NULL,
    "subject_id"   VARCHAR(25)  NOT NULL,
    "item_key"     TEXT         NOT NULL,
    "target"       VARCHAR(128) NOT NULL,
    "chunk"        INTEGER      NOT NULL DEFAULT 0,
    "model"        VARCHAR(128) NOT NULL,
    "params"       JSONB        NOT NULL,
    "est_tokens"   INTEGER      NOT NULL DEFAULT 0,
    "status"       VARCHAR(16)  NOT NULL DEFAULT 'PENDING',
    "result"       JSONB,
    "error"        TEXT,
    "tokens_in"    INTEGER      NOT NULL DEFAULT 0,
    "tokens_out"   INTEGER      NOT NULL DEFAULT 0,
    "tokens_cached" INTEGER     NOT NULL DEFAULT 0,
    -- How the structured answer came back: tool | content-json | json_object | text,
    -- with "+retry" when it took the doubled max_tokens retry.
    "exec_path"    VARCHAR(32),
    "created_at"   TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "kb_run_request_pkey" PRIMARY KEY ("custom_id"),
    CONSTRAINT "kb_run_request_run_id_fkey"
        FOREIGN KEY ("run_id") REFERENCES "wiki"."kb_run" ("id") ON DELETE CASCADE,
    CONSTRAINT "kb_run_request_status_check" CHECK ("status" IN
        ('PENDING', 'SUBMITTED', 'DONE', 'FAILED', 'DEFERRED'))
);
CREATE INDEX "kb_run_request_run_stage_idx" ON "wiki"."kb_run_request" ("run_id", "stage", "status");

-- A file's content is sent to the LLM once per (fingerprint, prompt version).
CREATE TABLE "wiki"."kb_file_digest" (
    "id"                  UUID         NOT NULL DEFAULT gen_random_uuid(),
    "file_id"             UUID,
    "content_fingerprint" VARCHAR(64)  NOT NULL,
    "prompt_version"      VARCHAR(16)  NOT NULL,
    "model"               VARCHAR(128) NOT NULL,
    "digest"              JSONB        NOT NULL,
    "tokens_in"           INTEGER      NOT NULL DEFAULT 0,
    "tokens_out"          INTEGER      NOT NULL DEFAULT 0,
    "created_at"          TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "kb_file_digest_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "kb_file_digest_file_id_fkey"
        FOREIGN KEY ("file_id") REFERENCES "wiki"."drive_file" ("id") ON DELETE SET NULL
);
CREATE UNIQUE INDEX "kb_file_digest_file_fp_idx"
    ON "wiki"."kb_file_digest" ("file_id", "content_fingerprint", "prompt_version");
-- Reuse across files/sources with the same content.
CREATE INDEX "kb_file_digest_fp_idx" ON "wiki"."kb_file_digest" ("content_fingerprint", "prompt_version");

-- The inputs a subject's wiki was last compiled from.
CREATE TABLE "wiki"."kb_subject_state" (
    "subject_id"  VARCHAR(25) NOT NULL,
    "inputs_hash" VARCHAR(64) NOT NULL,
    "inputs"      JSONB       NOT NULL,
    "compiled_at" TIMESTAMPTZ NOT NULL,
    "last_run_id" UUID,
    CONSTRAINT "kb_subject_state_pkey" PRIMARY KEY ("subject_id"),
    CONSTRAINT "kb_subject_state_subject_id_fkey"
        FOREIGN KEY ("subject_id") REFERENCES "public"."subject" ("id") ON DELETE CASCADE
);



-- Model catalog (docs/SUBJECT-WIKI-ADMIN.md): DO model ids, prices per
-- million tokens (USD), batch support, probe results. A model can only be
-- picked in the runtime settings after a successful probe.
CREATE TABLE "wiki"."kb_model" (
    "id"                VARCHAR(128)   NOT NULL,
    "display_name"      VARCHAR(128)   NOT NULL,
    "provider"          VARCHAR(32)    NOT NULL,
    -- Rule: commercial anthropic/openai models only; a batch probe overrides it.
    "batch_supported"   BOOLEAN        NOT NULL DEFAULT FALSE,
    "batch_source"      VARCHAR(8)     NOT NULL DEFAULT 'rule',
    "batch_verified_at" TIMESTAMPTZ,
    "tool_calling"      VARCHAR(8)     NOT NULL DEFAULT 'unknown',
    -- Accepts reasoning_effort (low|medium|high), e.g. GLM (a reasoning model).
    "supports_reasoning_effort" BOOLEAN NOT NULL DEFAULT FALSE,
    "enabled"           BOOLEAN        NOT NULL DEFAULT TRUE,
    "input_per_m"       NUMERIC(10, 4),
    "output_per_m"      NUMERIC(10, 4),
    "cache_read_per_m"  NUMERIC(10, 4),
    "batch_discount"    NUMERIC(4, 3)  NOT NULL DEFAULT 0.5,
    -- false while batch_discount is DO's advertised "up to 50%" (an estimate).
    "batch_discount_verified" BOOLEAN NOT NULL DEFAULT FALSE,
    "context_window"    INTEGER,
    "notes"             TEXT,
    "prices_updated_at" TIMESTAMPTZ,
    "last_probe"        JSONB,
    "created_at"        TIMESTAMPTZ    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "kb_model_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "kb_model_tool_calling_check" CHECK ("tool_calling" IN ('unknown', 'yes', 'no')),
    CONSTRAINT "kb_model_batch_source_check" CHECK ("batch_source" IN ('rule', 'probe')),
    CONSTRAINT "kb_model_batch_discount_check" CHECK ("batch_discount" >= 0 AND "batch_discount" <= 1)
);

-- Model ids as DO serves them (checked against GET /v1/models).
INSERT INTO "wiki"."kb_model" ("id", "display_name", "provider", "batch_supported", "supports_reasoning_effort",
                               "input_per_m", "output_per_m", "cache_read_per_m", "batch_discount", "prices_updated_at") VALUES
    ('glm-5.3',                     'GLM-5.3',           'zhipu',     FALSE, TRUE,  1.40,  4.40, 0.26,  0.5, CURRENT_TIMESTAMP),
    ('glm-5.3-flash',               'GLM-5.3 Flash',     'zhipu',     FALSE, TRUE,  0.15,  0.50, 0.03,  0.5, CURRENT_TIMESTAMP),
    ('anthropic-claude-haiku-4.5',  'Claude Haiku 4.5',  'anthropic', TRUE,  FALSE, 1.00,  5.00, 0.10,  0.5, CURRENT_TIMESTAMP),
    ('anthropic-claude-sonnet-5.5', 'Claude Sonnet 5.5', 'anthropic', TRUE,  FALSE, 2.00, 10.00, 0.20,  0.5, CURRENT_TIMESTAMP),
    ('openai-gpt-oss-120b',         'gpt-oss-120b',      'openai',    FALSE, FALSE, 0.10,  0.70, NULL,  0.5, CURRENT_TIMESTAMP),
    ('deepseek-4-flash',            'DeepSeek 4 Flash',  'deepseek',  FALSE, FALSE, 0.14,  0.28, 0.028, 0.5, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;

-- Runtime settings: one row overriding the env defaults, plus history.
CREATE TABLE "wiki"."kb_pipeline_settings" (
    "id"         INTEGER     NOT NULL DEFAULT 1,
    "settings"   JSONB       NOT NULL DEFAULT '{}'::jsonb,
    "updated_by" UUID,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "kb_pipeline_settings_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "kb_pipeline_settings_single_row" CHECK ("id" = 1)
);

CREATE TABLE "wiki"."kb_pipeline_settings_history" (
    "id"         UUID        NOT NULL DEFAULT gen_random_uuid(),
    "settings"   JSONB       NOT NULL,
    "changed_by" UUID,
    "changed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note"       TEXT,
    CONSTRAINT "kb_pipeline_settings_history_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "kb_pipeline_settings_history_changed_idx" ON "wiki"."kb_pipeline_settings_history" ("changed_at" DESC);

-- One row per LLM request result, priced at the catalog price of that
-- moment (history is never re-priced; GET /costs?reprice=true does it on read).
CREATE TABLE "wiki"."kb_llm_usage" (
    "id"                  UUID           NOT NULL DEFAULT gen_random_uuid(),
    "created_at"          TIMESTAMPTZ    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "run_id"              UUID,
    "eval_id"             UUID,
    "request_id"          VARCHAR(64),
    "model"               VARCHAR(128)   NOT NULL,
    "mode"                VARCHAR(8)     NOT NULL,
    "stage"               VARCHAR(16)    NOT NULL,
    "subject_id"          VARCHAR(25),
    "input_tokens"        INTEGER        NOT NULL DEFAULT 0,
    "cached_input_tokens" INTEGER        NOT NULL DEFAULT 0,
    "output_tokens"       INTEGER        NOT NULL DEFAULT 0,
    "cost_usd"            NUMERIC(14, 6) NOT NULL DEFAULT 0,
    -- Produced by the fake executors (tests, local demo), not a real provider.
    "simulated"           BOOLEAN        NOT NULL DEFAULT FALSE,
    CONSTRAINT "kb_llm_usage_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "kb_llm_usage_mode_check" CHECK ("mode" IN ('BATCH', 'SYNC'))
);
CREATE INDEX "kb_llm_usage_created_idx" ON "wiki"."kb_llm_usage" ("created_at");
CREATE INDEX "kb_llm_usage_run_idx" ON "wiki"."kb_llm_usage" ("run_id");
CREATE INDEX "kb_llm_usage_eval_idx" ON "wiki"."kb_llm_usage" ("eval_id");

-- Benchmark sets: subjects with frozen inputs (file ids, fingerprints, the
-- digests used; texts frozen in storage under kb/evals/sets/<id>/).
CREATE TABLE "wiki"."kb_eval_set" (
    "id"            UUID        NOT NULL DEFAULT gen_random_uuid(),
    "name"          TEXT        NOT NULL,
    "subject_ids"   JSONB       NOT NULL,
    "created_by"    UUID,
    "created_at"    TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "frozen_inputs" JSONB,
    "frozen_at"     TIMESTAMPTZ,
    CONSTRAINT "kb_eval_set_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "kb_eval_set_name_idx" ON "wiki"."kb_eval_set" ("name");

-- An evaluation: PLAN + WRITE as a full rebuild of the set, per model
-- configuration; executed as a kb_run with trigger EVAL; never published.
CREATE TABLE "wiki"."kb_eval" (
    "id"          UUID        NOT NULL,
    "set_id"      UUID        NOT NULL,
    "configs"     JSONB       NOT NULL,
    "note"        TEXT,
    "results"     JSONB       NOT NULL DEFAULT '{}'::jsonb,
    "created_by"  UUID,
    "created_at"  TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMPTZ,
    CONSTRAINT "kb_eval_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "kb_eval_set_id_fkey" FOREIGN KEY ("set_id") REFERENCES "wiki"."kb_eval_set" ("id") ON DELETE CASCADE,
    CONSTRAINT "kb_eval_run_fkey" FOREIGN KEY ("id") REFERENCES "wiki"."kb_run" ("id") ON DELETE CASCADE
);
CREATE INDEX "kb_eval_set_idx" ON "wiki"."kb_eval" ("set_id", "created_at" DESC);

-- Blind A/B review. A row is created when a pair is served (labels hidden)
-- and completed by the rating; one per reviewer per page pair.
CREATE TABLE "wiki"."kb_eval_rating" (
    "id"           UUID        NOT NULL DEFAULT gen_random_uuid(),
    "eval_id"      UUID        NOT NULL,
    "subject_id"   VARCHAR(25) NOT NULL,
    "slug"         VARCHAR(128) NOT NULL,
    "config_a"     VARCHAR(300) NOT NULL,
    "config_b"     VARCHAR(300) NOT NULL,
    "reviewer_id"  UUID        NOT NULL,
    "winner"       VARCHAR(300),
    "accuracy_a"   SMALLINT, "clarity_a" SMALLINT, "usefulness_a" SMALLINT,
    "accuracy_b"   SMALLINT, "clarity_b" SMALLINT, "usefulness_b" SMALLINT,
    "comment"      TEXT,
    "assigned_at"  TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rated_at"     TIMESTAMPTZ,
    CONSTRAINT "kb_eval_rating_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "kb_eval_rating_eval_id_fkey" FOREIGN KEY ("eval_id") REFERENCES "wiki"."kb_eval" ("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX "kb_eval_rating_pair_idx"
    ON "wiki"."kb_eval_rating" ("eval_id", "subject_id", "slug", "reviewer_id", "config_a", "config_b");
