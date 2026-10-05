-- Wiki pipeline: custom OpenAI-compatible LLM endpoints (staff's own GPU server).
-- Models of an endpoint live in wiki.kb_model with id custom/<name>/<modelId>.
-- api_key_encrypted is AES-GCM ciphertext (KB_SECRETS_KEY); never returned by the API.
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
