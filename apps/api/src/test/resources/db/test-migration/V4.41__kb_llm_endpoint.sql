-- Test mirror of V51 (DDL only). Custom OpenAI-compatible LLM endpoints.
CREATE TABLE "wiki"."kb_llm_endpoint" (
    "id"                UUID         NOT NULL,
    "name"              VARCHAR(48)  NOT NULL,
    "base_url"          VARCHAR(512) NOT NULL,
    "api_key_encrypted" TEXT,
    "max_concurrency"   INTEGER      NOT NULL DEFAULT 2,
    "timeout_sec"       INTEGER      NOT NULL DEFAULT 600,   -- PT10M
    "enabled"           BOOLEAN      NOT NULL DEFAULT TRUE,
    "created_by"        UUID,
    "created_at"        TIMESTAMPTZ  NOT NULL,
    "updated_by"        UUID,
    "updated_at"        TIMESTAMPTZ  NOT NULL,
    CONSTRAINT "kb_llm_endpoint_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "kb_llm_endpoint_name_key" UNIQUE ("name")
);
