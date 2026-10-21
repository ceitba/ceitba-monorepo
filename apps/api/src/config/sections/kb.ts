import { z } from 'zod';
import { defineSection } from '../registry';

// kb.* (application.yml): subject wikis, inference, embeddings, pipeline.
const schema = z.object({
  staleYears: z.number().int(),
  llm: z.object({
    baseUrl: z.string(),
    apiKey: z.string(),
    useFake: z.boolean(),
    executionMode: z.string(),
    syncConcurrency: z.number().int(),
    requestTimeoutMs: z.number(),
  }),
  embeddings: z.object({
    enabled: z.boolean(),
    baseUrl: z.string(),
    apiKey: z.string(),
    model: z.string(),
    queryTemplate: z.string(),
    documentTemplate: z.string(),
    /** KB_EMBEDDING_USE_FAKE, falling back to KB_LLM_USE_FAKE. */
    useFake: z.boolean(),
    intervalMs: z.number(),
    batchSize: z.number().int(),
    requestTimeoutMs: z.number(),
  }),
  secretsKey: z.string(),
  pipeline: z.object({
    enabled: z.boolean(),
    /** Spring 6-field cron (sec min hour dom mon dow). */
    cron: z.string(),
    pollIntervalMs: z.number(),
    batchPollIntervalMs: z.number(),
    modelDigest: z.string(),
    modelPlan: z.string(),
    modelWrite: z.string(),
    modelRetry: z.string(),
    runTokenBudget: z.number().int(),
    /** Raw decimal string (BigDecimal in Java). */
    runCostBudgetUsd: z.string(),
    runTokenBudgetMax: z.number().int(),
    maxRequestsPerStage: z.number().int(),
    batchMaxRequests: z.number().int(),
    digestMaxMissingRatio: z.number(),
    retryRejected: z.boolean(),
    background: z.boolean(),
  }),
});

declare module '../registry' {
  interface ConfigSections { kb: z.infer<typeof schema> }
}

export default defineSection('kb', schema, ({ env }) => ({
  staleYears: env.int('KB_STALE_YEARS', 3),
  llm: {
    baseUrl: env.str('KB_LLM_BASE_URL', 'https://inference.do-ai.run'),
    apiKey: env.str('KB_LLM_API_KEY', ''),
    useFake: env.bool('KB_LLM_USE_FAKE', false),
    executionMode: env.str('KB_EXECUTION_MODE', 'auto'),
    syncConcurrency: env.int('KB_SYNC_CONCURRENCY', 16),
    requestTimeoutMs: env.duration('KB_LLM_REQUEST_TIMEOUT', 'PT5M'),
  },
  embeddings: {
    enabled: env.bool('KB_EMBEDDINGS_ENABLED', true),
    baseUrl: env.str('KB_EMBEDDING_BASE_URL', ''),
    apiKey: env.str('KB_EMBEDDING_API_KEY', ''),
    model: env.str('KB_EMBEDDING_MODEL', 'embeddinggemma-2'),
    queryTemplate: env.str('KB_EMBEDDING_QUERY_TEMPLATE', ''),
    documentTemplate: env.str('KB_EMBEDDING_DOCUMENT_TEMPLATE', ''),
    useFake: env.bool('KB_EMBEDDING_USE_FAKE', env.bool('KB_LLM_USE_FAKE', false)),
    intervalMs: env.duration('KB_EMBEDDING_INTERVAL', 'PT5M'),
    batchSize: env.int('KB_EMBEDDING_BATCH_SIZE', 16),
    requestTimeoutMs: env.duration('KB_EMBEDDING_REQUEST_TIMEOUT', 'PT2M'),
  },
  secretsKey: env.str('KB_SECRETS_KEY', ''),
  pipeline: {
    enabled: env.bool('KB_PIPELINE_ENABLED', false),
    cron: env.str('KB_PIPELINE_CRON', '0 0 3 * * SUN'),
    pollIntervalMs: env.duration('KB_POLL_INTERVAL', 'PT10M'),
    batchPollIntervalMs: env.duration('KB_BATCH_POLL_INTERVAL', 'PT1M'),
    modelDigest: env.str('KB_MODEL_DIGEST', 'glm-5.3-flash'),
    modelPlan: env.str('KB_MODEL_PLAN', 'glm-5.3'),
    modelWrite: env.str('KB_MODEL_WRITE', 'glm-5.3'),
    modelRetry: env.str('KB_MODEL_RETRY', ''),
    runTokenBudget: env.int('KB_RUN_TOKEN_BUDGET', 3000000),
    runCostBudgetUsd: env.str('KB_RUN_COST_BUDGET_USD', '5.00'),
    runTokenBudgetMax: env.int('KB_RUN_TOKEN_BUDGET_MAX', 50000000),
    maxRequestsPerStage: env.int('KB_RUN_MAX_REQUESTS_PER_STAGE', 5000),
    batchMaxRequests: env.int('KB_BATCH_MAX_REQUESTS', 5000),
    digestMaxMissingRatio: env.num('KB_DIGEST_MAX_MISSING_RATIO', 0.2),
    retryRejected: env.bool('KB_RETRY_REJECTED', true),
    background: env.bool('KB_PIPELINE_BACKGROUND', true),
  },
}));
