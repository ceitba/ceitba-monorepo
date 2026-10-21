# Subject wiki self-update pipeline

Weekly, automated, change-driven regeneration of the subject wikis (`docs/SUBJECT-WIKI.md`) through
DigitalOcean **batch** inference. Design doc: https://claude.ai/code/artifact/fc40934b-7324-4fa7-a45a-6657f42a98c7

## Rules

1. **Weekly.** One run per week (default Sunday 03:00 America/Argentina/Buenos_Aires, `KB_PIPELINE_CRON`).
   Staff can trigger a run manually. Takedowns stay immediate and need no LLM: the page is hidden at once,
   as today, and the rewrite without that source waits for the next weekly run.
2. **Only subjects whose content changed are processed.** A subject is *dirty* when its published inputs differ from the
   snapshot of its last successful compile (see "Change detection"). Clean subjects cost zero tokens.
3. **No re-reading unless something changed.** A file's text is sent to the LLM exactly once per content version
   (`content_fingerprint`). Unchanged files are represented by their stored digest and by the existing pages, never by
   their raw text. A page that none of the changes touch is never sent for rewriting.
4. **All LLM calls go through DigitalOcean batch inference** (`https://inference.do-ai.run/v1/batches…`, `provider: anthropic`),
   never synchronous calls. Model: `anthropic-claude-haiku-4.5` for every stage (`KB_MODEL`), with Sonnet only by explicit
   per-subject override (`kb_subject_settings.model`).

## Change detection

- `wiki.kb_file_digest (file_id, content_fingerprint, prompt_version, model, digest jsonb, tokens_in, tokens_out, created_at)`,
  unique on `(file_id, content_fingerprint, prompt_version)`. A digest exists ⇒ that content is never sent again,
  unless `prompt_version` is bumped on purpose.
- `wiki.kb_subject_state (subject_id PK, inputs_hash, inputs jsonb, compiled_at, last_run_id)`.
  `inputs` = the sorted list of `{fileId, fingerprint, academicYear}` of the subject's PUBLISHED, non-hidden files with
  usable text. `inputs_hash` = sha256 of it.
- At run start, for each subject with published files or existing kb pages, compute the current inputs and diff them
  against the stored ones:
  - `added` (new file ids), `changed` (same id, new fingerprint), `removed` (gone, unpublished, hidden or removed by staff).
  - The subject is dirty iff any list is non-empty. Year-only changes don't make it dirty; years are read live from sources.
- **Baseline:** `POST /v1/staff/kb/pipeline/baseline` records the current inputs of every subject that has kb pages as
  compiled. It is used once after the hand-written import, so the first run doesn't regenerate everything.

## Privacy

- A file's digests are deleted with the file (`kb_file_digest.file_id` is `ON DELETE CASCADE` since V40; orphaned
  digests were dropped). Evals never keep a digest of a file that no longer exists.
- When file rows are deleted (disconnect, account deletion, 30-day purge of files removed from Drive),
  `KbModerationService.forgetFiles` (`src/features/kb-reader/moderationService.ts`) hides the pages citing them, deletes their digests, redacts their `DIGEST`
  requests (`params` → `{}`, `result` → `NULL`; the only requests carrying raw text) and deletes the eval sets'
  frozen copies of their text (`kb/evals/sets/<set>/<file>.txt`).
- Retention: the JSONL of finished jobs of finished runs (`kb/runs/<runId>/*`) is deleted 30 days after the job was
  created (`src/features/kb-pipeline/retention.ts`, nightly with `KbRelationJob` in `src/features/kb-reader/jobs.ts`); the job's `payloadKey`/`outputKey` are cleared.
  The API's MinIO service user may delete under `kb/` for this (`minio-init`).

## Stages (each LLM stage is one DO batch for all dirty subjects together)

```
DETECT → DIGEST (batch) → PLAN (batch) → WRITE (batch) → [RETRY (batch, optional)] → LINK → VALIDATE → PUBLISH
```

1. **DETECT** (code): dirty subjects + their `added`/`changed`/`removed` lists; skip subjects over budget (see "Budget").
2. **DIGEST** (batch): one request per *chunk* (~20k tokens) of each added/changed file without a digest.
   - Each request records the fingerprint of the text it actually sent (`kb_run_request.content_fingerprint`, V41);
     the digest is stored under it. Every added/changed input then needs a digest for the fingerprint DETECT saw: if
     its digest failed (also for another file with the same content) or the file changed during the run, that file
     is *unread*. Unread files are left out of the subject's inputs for this run (never planned with `digest: null`),
     not recorded as compiled (next run retries them) and the subject fails only above the tolerance (see
     "Graceful fallback").
   - A file split in chunks where some failed keeps the merged digest of the others, stored under its fingerprint with
     `partial: true` and `failedChunks`; PLAN/WRITE see `partial: true`, and the next run digests the file again
     (a partial digest never counts as "known") and replaces it.
   - Reasoning models (`supportsReasoningEffort`) get headroom on top of the stage's `maxTokens`, because their
     thinking counts against `max_tokens`/`max_completion_tokens`: +1000 minimal, +4000 low, +8000 medium (or unset),
     +16000 high, capped at the sync cap (32000) and the model's `maxOutputTokens`. A TRUNCATED/EMPTY answer is
     retried once with double `max_tokens` (cap 32000) in sync and in batch (the batch line renames it to
     `max_completion_tokens` for OpenAI).
   - Output: JSON via tool use:
     `{ topics: [{ name, aliases, summary, keyPoints, formulas }], materialKind, unitHint, language }`.
   - Multi-chunk files are merged deterministically in code; no LLM merge.
3. **PLAN** (batch): one request per dirty subject.
   - Input:
     - the current page index of the subject (`slug, type, title, summary, aliases, sources`, **no page bodies**);
     - the digests of added/changed files only;
     - the list of removed file ids with the pages citing them;
     - the page index (titles/aliases/summaries) of up to 8 related subjects (`kb_subject_relation`).
   - Output (tool use):
     `{ operations: [{ op: create|update|delete, slug, type, title, sources: [fileId], reason, mustCover: [string] }] }`.
   - `mustCover` (required; may be empty for `delete` and `index`): 2-8 items naming each definition, method, theorem or
     formula the page must present, taken from the digests' `formulas`/`keyPoints` (LaTeX for quantitative topics).
     Validation keeps it as an array of trimmed strings (max 10, 300 chars each); missing or invalid becomes `[]`, the op
     is never dropped for it. It is copied into the WRITE and RETRY request bodies (pipeline and eval).
   - Reject reason `missing_formula`: if a `mustCover` item contains LaTeX (a backslash command, or `^`/`_` followed by
     a brace) and the written page has no `$` math at all, the page is rejected with `missing_formula: the plan
     required formulas (...) but the page has none` (checked with the op in hand, in the pipeline and in evals; counted
     in the eval's `rejectReasons`; the retry prompt tells the writer to add the formulas).
   - Rules given to the model:
     - update only pages whose sources changed or were removed, or that a new file clearly extends;
     - create pages for new key concepts the new material explains;
     - delete pages that lost all their sources;
     - never touch other pages.
   - Every op field is **required** in the tool schema; `sources` must be input `fileId`s copied exactly, at least one
     for create/update (only a delete may have none).
   - Validation drops unusable ops (`noSources`, `unknownSources`, `invalidSlug`, `duplicateSlug`, `invalidOp`,
     `unknownPage`; evals also `deleteIgnored`). Drops are logged (WARN: run, subject, model, count per reason) and
     recorded: `kb_run.stats.droppedPlanOps.<subjectId>` (exposed as `droppedPlanOps` on the run's subjects) or the
     eval's `results.configs.<key>.subjects.<id>.droppedPlanOps`, as `{proposed, kept, dropped: {reason: n}}`.
   - If the model proposed ops but **none** survived, that PLAN request is sent once more (as the stage's second
     attempt, `KbRunHandler.redo`) with a corrective note listing the valid file ids. Still empty → the subject fails
     with `PLAN: plan returned no operations with valid sources`.
   - Index-only plans: a subject compiled for the first time (no live pages) with at least 2 usable sources whose kept
     ops are only the `index` page is **insufficient**, handled exactly like an empty plan (one retry with a note asking
     for topic and concept pages; still insufficient → the subject fails with `PLAN: plan_insufficient: …`). An index
     page planned as `indice`/`índice` with `type: index` is normalised to the slug `index`.
4. **WRITE** (batch): one request per create/update op.
   - Input:
     - the current page Markdown (for updates);
     - the digests of its new/changed sources;
     - **raw text excerpts only from added/changed files** (selected by topic, capped at about 12k tokens);
     - for removed sources, an instruction to drop what came only from them;
     - the subject's page index (for links and anchors);
     - the writing rules (port `KB-WRITER.md`, see below).
   - Output: the full page file (frontmatter + Markdown).
   - Delete ops need no LLM.
5. **LINK** (code): port of the deterministic linker. The first mention of a same-subject page title or alias in every
   section is linked; it runs on the new and updated pages and on unchanged pages of the same subject (no LLM).
6. **VALIDATE** (code): the existing import validator, plus the coverage rule "no unlinked mention of a same-subject page"
   and the anchor check. The parser also rejects raw HTML tags/comments, `javascript:`/`data:`/`vbscript:` links,
   images loaded from another site, and slugs/generators/links longer than their columns (that page only, with a
   reason; rejected generated pages go to RETRY).
7. **RETRY** (optional, `KB_RETRY_REJECTED=true`): one extra batch with only the rejected pages, each with its validator errors.
   Whatever still fails keeps its previous version (or isn't created) and is reported.
8. **PUBLISH** (code): through the existing import service (one transaction per subject, revisions), then update
   `kb_subject_state` with the inputs that were actually used. A subject whose run failed stays dirty for next week.
   Only what made it in counts as compiled: the sources of a create/update that was rejected (after RETRY) or got no
   answer keep their previously compiled version (a new file stays absent), and a removed file still cited by such a
   page stays recorded, so a failed forced rewrite after a takedown is tried again next run. A subject where every
   write failed (and nothing was deleted) is `FAILED`; one with some failures is `PUBLISHED` with an `error` and makes
   the run `PARTIAL`.

## Graceful fallback

Nothing short of a run-level failure stops a run; failures degrade per item.

- **Request:** an unparseable/failed answer, or an answer the database refuses to store, fails that request only
  (a page of batch answers that fails to store is recorded answer by answer). Audit copies, run artifacts in
  storage and progress summaries are best effort: they log WARN and never fail a stage.
- **Page:** a page rejected or unanswered after RETRY is skipped; the subject's other valid pages publish, and the
  sources of the failed page stay uncompiled (next run retries them).
- **File:** unread files (no digest at all) are skipped for the run and retried next run. The subject FAILS only if
  more than `KB_DIGEST_MAX_MISSING_RATIO` (default 0.2) of its added+changed files are unread, or all of them.
  Otherwise it publishes with the note "N archivos sin resumen; se reintentan en la próxima corrida" (PARTIAL).
  `kb_run_subject.skipped` (V50) lists them; `KbRunSubjectResponse.skippedFiles` shows the count.
- **Subject:** an exception in BUILD, DIGEST check, PLAN answer, WRITE/RETRY validation (links, validation) or
  PUBLISH marks only that subject FAILED with a short reason (WARN log with run id and subject); it stays dirty.
- **Run:** SUCCEEDED when everything went through; PARTIAL when some subjects failed, were published with rejected
  pages or unread files, or were DEFERRED (`error` carries "3 materias con fallas, 12 diferidas"; with budget deferrals "34 materias completadas · 192 diferidas por presupuesto (US$ X estimado)"); FAILED when
  every subject failed, or at run level (cost cap, cancel, DO account error, restart loop).
- **Engine:** an exception in a step is recorded on the run (`error`) and the step is retried with back-off (1, 2, 4
  minutes) on the next poll; after `MAX_STEP_FAILURES` (4) consecutive failures of the same stage the run is FAILED.

## Orchestration

- `wiki.kb_run`: `id, trigger (SCHEDULED|MANUAL), status, stage, started_at, finished_at, subjects jsonb, stats jsonb,
  tokens_in, tokens_out, cost_estimate, error`.
- `wiki.kb_batch_job`: `id, run_id, stage, attempt, model, do_batch_id, do_file_id, status
  (DRY|QUEUED|SUBMITTED|COMPLETED|FAILED|CANCELLED), request_count, submitted_at, completed_at,
  output_file_url_fetched_at, error, next_attempt_at, submit_failures, do_request_id`.
  - Request payloads (JSONL) are stored in MinIO under `kb/runs/<runId>/<stage>.jsonl`, and results under `…-out.jsonl`, for audit.
- `KbPipelineJob` (`src/features/kb-pipeline/jobs.ts`: the safety sweep every `KB_POLL_INTERVAL`, 10 min, and the
  batch poller, see "Advancing runs") advances runs:
  - submit pending stages;
  - poll DO batch status (`validating|queued|in_progress|completed|failed|cancelling|cancelled|expired`);
  - on `completed`, download the output and error files, parse them by `custom_id`, persist, and move to the next stage.
  - `expired`/`failed`: keep partial results; the requests not completed are resubmitted once in a follow-up batch,
    otherwise the subject stays dirty.
    A batch DO fails as a whole (e.g. `JSONL model validation failed: … unsupported model …`, `request_counts.total: 0`)
    is not resubmitted: its requests fail with DO's `error_message`, which is stored in `kb_batch_job.error`, the run's
    `error` and the progress (`stages[].batch.error`).
  - Must survive API restarts: all state is in the DB.
- One active run at a time. A manual trigger while a run is active → 409.
- `custom_id` format: `<runId>:<stage>:<subjectId>:<slug|fileId>:<chunk>`.

## DigitalOcean batch client (`src/external/llm/`)

- `LlmBatchClient` interface (`src/features/kb/logic/external/llmApi.ts`) plus `DoBatchClient`
  (`src/external/llm/doBatchClient.ts`, selected in `src/external/llm.ts`), following the `src/external/itba` pattern:
  - `createFile(name)` → `{fileId, uploadUrl}` (`POST /v1/batches/files`);
  - `upload(uploadUrl, bytes)`: PUT raw bytes, no extra headers;
  - `createBatch(fileId, provider="anthropic", completionWindow="24h", requestId)`: `POST /v1/batches`, no `endpoint` for Anthropic;
  - `get(batchId)`: `GET /v1/batches/{id}`;
  - `results(batchId)` → `{outputFileUrl, errorFileUrl}`;
  - `cancel(batchId)`.
- Anthropic JSONL line: `{"custom_id": "...", "params": {"model": "...", "max_tokens": N, "system": "...", "messages": [...], "tools": [...], "tool_choice": {...}}}`.
- Parse output lines by `custom_id`; record `usage` into `kb_batch_job`/`kb_run`.
- **Verify the exact output shape for Anthropic and the model id accepted for Haiku 4.5** with a tiny real batch before relying on it.
  The docs only show an OpenAI-shaped output example and an old model id.
- `FakeLlmBatchClient` (`src/features/kb/logic/external/fakeLlm.ts`, `KB_LLM_USE_FAKE`) for tests: completes immediately with canned or scripted outputs, keyed by stage.
- Config: `KB_LLM_BASE_URL` (default `https://inference.do-ai.run`), `KB_LLM_API_KEY` (a DO model access key),
  `KB_MODEL`, `KB_PIPELINE_ENABLED` (default false), `KB_PIPELINE_CRON`, `KB_POLL_INTERVAL`, `KB_RUN_TOKEN_BUDGET`, `KB_RETRY_REJECTED`.

## DigitalOcean quotas (`DoQuotaTracker`, `src/features/kb/logic/external/doQuotaTracker.ts`)

Every DO response (429s included) updates an in-memory snapshot of its `x-ratelimit-limit-*`/`remaining-*` counters (no DB).
- **Batch creations:** before creating a batch (`BatchLlmExecutor.submit` in `src/features/kb/logic/llm/batchLlmExecutor.ts`, so also the catalog's batch probe), if the snapshot
  says `batch-creations-per-hour` has 0 left and was observed under 60 min ago, DO is not called: the job stays QUEUED with
  `next_attempt_at = observedAt + 10 min` (error `QUOTA_WAIT: Esperando cupo de lotes de DigitalOcean: 0/5 esta hora`). When due,
  the free probe refreshes the snapshot (at most once a minute) and the check repeats. The 429 back-off remains the fallback.
- **Sync daily tokens (`tokens_per_day`):** `DoChatClient` throws `DoQuotaExhaustedError` at once (no retries), and
  `SyncLlmExecutor` (`src/features/kb/logic/llm/syncLlmExecutor.ts`) also stops before a request when the snapshot (under 30 min old) has fewer daily tokens left than it
  needs (prompt chars / 4 + `max_tokens`). `KbRunEngine` (`src/features/kb-pipeline/engine.ts`) then pauses instead of failing: unanswered requests stay SUBMITTED
  without answer (the state a restart resumes from, never FAILED), their job stays open, and the run goes WAITING with the
  reason until +30 min (in memory; the batch poller kicks the run when due; reset headers are 0, so a stale snapshot is
  ignored and a real request re-checks). Batch usage does not count toward `tokens_per_day`.

## Budget

### Cost budget and admission (before DIGEST)

Incident: a run spent US$ 0.67 (9.9M tokens, all DIGEST) on two huge subjects (22.99: 1,422 files, 7.2M tokens; 93.43:
459 files, 4.5M), left no token budget for PLAN/WRITE, and all 226 subjects ended DEFERRED with nothing published. A
token budget also weighs cheap DIGEST tokens (nano, batch) like expensive WRITE tokens (sync).

The budget is now money. `runCostBudgetUsd` (env `KB_RUN_COST_BUDGET_USD`, default 5.00, 0.10 to 100) is spent
by **admission**, which runs in DETECT, before any LLM call:
1. Each dirty subject's **whole** cost is estimated with the forecast heuristics (`KbForecastService.subjectEstimates`, `src/features/kb-admin/forecast.ts`):
   DIGEST of the files **without a cached full digest** only (a subject left with cached digests by an earlier run is
   cheap now), plus PLAN, WRITE and RETRY, tokens times the per-stage model's effective price (batch discount included).
2. Subjects are sorted **smallest estimated cost first** (ties: oldest dirty first, meaning never compiled, then oldest
   `compiledAt`, then id). `kb_run_subject.priority` stores that order (higher first) so every stage follows it.
3. A subject is admitted only if its whole estimate fits the remaining cost budget (and the remaining
   `runTokenBudget`). Others are DEFERRED right away, **never digested**, with the reason
   `presupuesto de la corrida (US$ X estimado)` in `kb_run_subject.error`; they stay dirty for the next run.
4. Exception: if nothing was admitted yet and the first candidate alone exceeds the budget, it is admitted **alone**
   (a dedicated run; everyone else is deferred). It is exempt from the token budget but not from the per-stage request
   caps: when its DIGEST needs more requests than the cap, whole files are digested up to the cap and the subject is
   DEFERRED ("digest parcial"); the digests are cached, so the next run continues from there.

The result is stored in `run.stats.budget` and returned as `budget` on the run (`limitUsd`, `estimatedUsd` of the
admitted subjects, `spentUsd` = recorded cost so far, `admitted`, `deferred`, `deferredEstimatedUsd`, `tokenBudget`,
`oversizedSubjectId`). The run summary (`error`) reads e.g. "34 materias completadas · 192 diferidas por presupuesto
(US$ 3.10 estimado)".

`KB_RUN_TOKEN_BUDGET` stays as a secondary hard cap on estimated input tokens (checked in admission and again when each
stage builds its requests; clamped to `KB_RUN_TOKEN_BUDGET_MAX`). Actual usage from the results is recorded per run, per
stage and per subject.

Hard caps, independent of the budget (a staff run once saved `runTokenBudget` = 5e12 and built 23,586 DIGEST requests,
which took the API down):
- `KB_RUN_TOKEN_BUDGET_MAX` (50,000,000): ceiling of `runTokenBudget`; PUT /settings refuses more and the value in use
  is clamped to it (a larger one already stored too).
- `KB_RUN_MAX_REQUESTS_PER_STAGE` (5,000): a stage never builds more requests; a subject that does not fit is deferred
  (like a budget deferral) and stays dirty for the next run. A single subject needing more than the cap is never built:
  raise the cap or split its corpus.
- `KB_BATCH_MAX_REQUESTS` (5,000; DO allows 50k): a stage with more requests for one model becomes several batch jobs
  (`kb_batch_job.part` 1..n, request id `<run>:<stage>:<attempt>:<model>[:pN]`, payload `...-pN.jsonl`). All parts are
  queued at once and each creation goes through the quota gate (DO: 5 creations/hour), waiting QUEUED when refused.

## Prompts

Versioned files in `src/features/kb/prompts/` (`digest`, `plan`, `write` and `retry`, each in `v1` and `v2`),
with `prompt_version` stored on digests and runs. `write` ports the rules of the hand-written pipeline:
- format and frontmatter;
- citations `[[file:<id>|short name]]` at the end of sentences, never wrapping content;
- every `##` section cited;
- Spanish slugs;
- no 40+ word copying;
- voseo;
- the concept-coverage rule with anchors;
- no invented facts;
- the false-friend warning for cross-subject links.

## Custom endpoints (own GPU)

Besides DigitalOcean, a stage can use a staff-registered OpenAI-compatible server (`custom:<endpoint>:<slug>`
catalog ids, slash-free; the raw model id is `kb_model.remote_model_id`; endpoint table `kb_llm_endpoint`, staff API in `docs/SUBJECT-WIKI-ADMIN.md`). `KbLlmRouter` (`src/features/kb/logic/llm/kbLlmRouter.ts`) never
batches them (`auto`/`batch` fall back to SYNC); `SyncLlmExecutor` sends the request to the endpoint's client
(`DoChatClient.openAiCompatible` in `src/features/kb/logic/external/doChatClient.ts`, base URL including `/v1`, raw model id in the body, no Authorization header when
the endpoint has no key) and bounds it with the endpoint's own semaphore (`max_concurrency`) instead of
`KB_SYNC_CONCURRENCY`. The record lock, the per-request concurrency (promises under the semaphore) and the throttled cancel check are unchanged. The DO daily
token quota check does not apply to custom models. Structured output uses tools, with the `json_object` fallback
used directly when the catalog says `toolCalling: no` (llama.cpp without `--jinja`). The endpoint token is encrypted
at rest (HKDF from `AUTH_JWT_SECRET`, optional `KB_SECRETS_KEY` override) and write-only.

## Staff endpoints

- `POST /v1/staff/kb/pipeline/runs` (manual trigger, `?dryRun=true` supported).
- `GET /v1/staff/kb/pipeline/runs?limit=` and `GET …/runs/{id}` (stage, per-subject status, tokens, rejected pages with errors).
- `POST /v1/staff/kb/pipeline/runs/{id}/cancel`.
- `POST /v1/staff/kb/pipeline/baseline`.
- `GET /v1/staff/kb/pipeline/preview`: what the next run would do (dirty subjects with their added/changed/removed lists,
  digests needed, estimated tokens), computed without calling DO.

**Dry run** builds every JSONL and stores it in MinIO but doesn't submit. Use it to inspect prompts and token estimates.

## Tests (FakeLlmBatchClient)

In-process, in `test/kb-pipeline/` (`BatchPipelineIT.test.ts`, `SyncPipelineIT.test.ts`) and `test/kb/pipeline/`:

- **No changes ⇒ zero requests:** a second run right after a completed one submits nothing.
- **One file changed in one subject:** exactly its chunks are digested. PLAN contains only that subject; WRITE contains only
  the planned pages; the raw text of other files is never present in any JSONL (assert on the stored payloads).
- **File removed by staff:** the page is hidden immediately; the next run rewrites the citing pages without it, with no raw
  text of the removed file in any payload.
- **Digest reuse:** the same fingerprint in another subject or source is not digested again.
- **Restart mid-run:** the poller resumes from the DB.
- **Budget deferral** keeps subjects dirty.
- **Validation failure** → RETRY batch → kept previous version.

## Implementation notes and deviations

- **Executors.** Each LLM stage runs as BATCH (DO `/v1/batches`, only `anthropic-*` / commercial `openai-*` models) or
  SYNC (OpenAI-compatible `/v1/chat/completions`, `KB_SYNC_CONCURRENCY` parallel requests, each answer persisted as it
  arrives). `KB_EXECUTION_MODE=auto|batch|sync`; the runtime settings override it. GLM, DeepSeek, Qwen, Kimi and
  gpt-oss have no batch on DO, so with the default GLM models every stage is SYNC.
- **Stored payloads.** The canonical request is Anthropic Messages params; the same JSONL lines are stored under
  `kb/runs/<runId>/<stage>[-attempt].jsonl` in both modes (outputs `-out.jsonl`, errors `-err.jsonl`;
  `reasoning_content` is stripped). MinIO denies anonymous reads of `kb/*`. Output copies are an audit trail written
  after the results are recorded, best effort: a storage error never loses answers that were paid for.
- **custom_id** is `<run8>-<StageLetter>-<seq6>` (Anthropic limits it to `[A-Za-z0-9_-]{1,64}`); the long
  `runId:stage:subject:slug:chunk` key is kept in `kb_run_request.item_key`.
- **Structured output.** Tools + forced `tool_choice`; with no tool call the content is parsed as JSON, then one
  retry with `response_format: json_object` (tool named in the system prompt). Empty/unparseable tool arguments or
  `finish_reason=length` are failures, retried once with double `max_tokens` (cap 32k) and counted in
  `emptyToolCallRate`.
- **Reasoning models.** Per-stage `reasoning_effort` (settings `reasoningEffort`) is sent only to catalog models with
  `supportsReasoningEffort`; `max_tokens` per stage defaults to 4000 / 6000 / 12000 / 12000.
- **Dry run** stops after PLAN (operations are shown, nothing is written).
- **Advancing runs:** a run or eval is advanced **as soon as it is created** (`POST /pipeline/runs`, dry runs included,
  `POST /evals`, approve-cost), in the background, one advance per run (`KbRunEngine.kick`), so a long sync stage of one run never delays
  another. Sync stages and the code-only steps (LINK, VALIDATE, PUBLISH) flow straight into the next stage. The
  **batch poller** (`KB_BATCH_POLL_INTERVAL`, default `PT1M`) only checks runs with a SUBMITTED DO batch or a QUEUED one
  whose `nextAttemptAt` is due (and pending batch probes). A **safety sweep** (`KB_POLL_INTERVAL`, default `PT10M`, and once at startup) kicks every active run to
  resume anything a restart interrupted. Each run has one advancer at a time: a lease on `kb_run` (`lease_owner`,
  `lease_until`, V37) taken with a conditional UPDATE and renewed every minute; a kick that finds the run busy makes the
  holder loop once more. `KB_PIPELINE_ENABLED` (or the settings' `enabled`) only gates the weekly cron.
  `KB_PIPELINE_BACKGROUND=false` (`src/config/sections/kb.ts`) turns all background work off (tests drive the engine).
- **Batch submission** (`src/features/kb/logic/pipeline/kbBatchSubmitter.ts`, V38). Idempotent and never fatal on rate limits:
  - The `kb_batch_job` row is created (`QUEUED`) in its own transaction **before** DO is called, under a unique index on
    `(run_id, stage, attempt, model)` (a stage has one job per model, e.g. per eval configuration). An advancer that
    finds the row already there never submits again. Advancing always holds the run's lease.
  - DO gets a deterministic `request_id` = `<runId>:<stage>:<attempt>:<model>`. Before re-creating a batch whose
    creation got no clear answer, `GET /v1/batches` (`{edges: [{node}], page_info}`) is checked for that request_id.
  - JSONL lines carry the model's **batch model id** (catalog `batchModelId`, else the catalog id without its
    `openai-`/`anthropic-` prefix: `openai-gpt-6-luna` → `gpt-6-luna`); sync requests keep the catalog id.
  - A `429` (`batch_create_per_minute`, `batch_creations_per_hour`), no response or 5xx on creation keeps the job
    `QUEUED` and the stage `waiting_batch` with `nextAttemptAt` after 1, 5, 15, 60 min, then hourly; the batch poller
    only picks it up when due. Progress `current` reads "DigitalOcean limitó la creación de lotes; reintento a las
    HH:MM". Any other refusal fails the job and its requests with DO's message.
  - **No sync fallback:** a stage resolved to BATCH either batches or waits; there is no `fallbackToSyncAfterMinutes`.
    (The execution mode is chosen per model when the stage is submitted; `batch` on a model without batch support
    resolves to sync up front, as before.)
- **Final status.** `FAILED` when every subject (pipeline; deferred/cancelled ones don't count) or every configuration
  (eval) failed, `PARTIAL` when some did, `SUCCEEDED` otherwise (also when there was nothing to do). `kb_run.status`
  is `VARCHAR(32)`; V38 adds `PARTIAL` to its check constraint.
- **Per-subject overrides** live in the settings (`subjectOverrides`) instead of a separate table.
- **Cost limit.** Before every submission (each stage and its resubmission) the cost recorded in `kb_llm_usage` by
  pipeline runs over the last 7 days (this run's answers included; evals not) plus the estimate of the requests about to
  go out is compared with `weeklyCostLimitUsd`; over it, the run goes to `BLOCKED_BY_COST_LIMIT`.
  `POST /v1/staff/kb/pipeline/runs/{id}/approve-cost` releases it for the rest of the run.
- **Cancel.** `cancel` cancels open DO batches, then marks the run, its jobs and active subjects `CANCELLED` with the
  run row locked (`SELECT … FOR UPDATE`). Every transition that may end or advance a run (DETECT, build, after-stage,
  each subject's PUBLISH, the final status, a failure) locks the row too and does nothing once the run is no longer
  active; RUNNING ↔ WAITING toggles after HTTP calls are conditional updates, and `kb_run` uses dynamic updates (the
  pipeline's session flushes only changed columns, `src/features/kb-pipeline/db/session.ts`) so writing totals never
  rewrites `status`. The sync executor stops dispatching once the run is inactive (answers already
  in flight are recorded in usage, they were paid for).
- **Schedule.** The minute tick fires when the cron had a fire time since the previous check; after a restart the
  previous check is the last `SCHEDULED` run's start (at most one day back), so a restart around the fire time does not
  skip the week.
- **Extra endpoints.** `POST /v1/staff/kb/pipeline/probe {model, mode?}` and `POST /v1/staff/kb/pipeline/compare`
  (an eval over a one-subject set).

## Performance

- **Chunks:** digests read files in chunks of about 8k input tokens (28,000 chars). Smaller chunks mean more requests
  in flight and a bounded answer per call; a 33k-token file is 4-5 chunks instead of one long request.
- **Bounded digest output** (prompt `digest.v2` and the tool schema): at most 12 topics per chunk, `summary` ≤ 300
  chars, `keyPoints` ≤ 5 × 160 chars, `formulas` ≤ 5, `aliases` ≤ 4; `reasoning_effort: low`. Changing the digest
  prompt/schema bumped `prompt_version` to `v2`, so v1 digests are regenerated once.
- **Concurrency:** SYNC stages run up to `KB_SYNC_CONCURRENCY` (default 4) requests at once, across every model of the
  stage (an eval's configurations run their PLAN/WRITE requests together). Each answer is persisted as it arrives
  (restart-safe). Stages are barriers: PLAN starts when every digest is in.
- **Retries:** an empty/unparseable tool answer or a cut at `max_tokens` is retried once with double `max_tokens`
  (cap 32k), never more; each HTTP call is its own usage row (`attempt`, `latency_ms`, `reasoning_tokens`).
- **Wall time (GLM, sync, measured on DO):** about 15-17 s for a request producing ~600 output tokens; a digest chunk
  of 8k tokens takes roughly 10-30 s; DO served 4 concurrent requests in about the time of one. Throughput is roughly
  concurrency ÷ average latency.
- **Batch** (Anthropic/OpenAI models only) trades wall time for cost: a batch may take up to its 24 h window, at an
  estimated 50% discount. Progress shows `waiting_batch` with DO's request counts and no ETA.
- **Progress:** `GET /v1/staff/kb/pipeline/runs/{id}/progress` (see the admin doc, "Progress").


## Memory

The Drive corpus (community archive included) is far larger than the API's memory limit allows: ~18k files, ~90 MB of
`text_content` in Postgres, more as in-memory strings. Nothing in the pipeline may load every file's text at once (two
dry runs of the earlier Java API died in DIGEST running out of memory when it did).

- **Inputs, diffs, preview and forecast** read ids, fingerprints, names and `length(text_content)` in SQL
  (`pipelineInputs` in `src/features/kb-pipeline/db/repo.ts`); token estimates come from those lengths, never from the texts.
- **DIGEST build:** per subject, the files to digest are first sized in SQL; a subject that cannot fit the remaining
  `KB_RUN_TOKEN_BUDGET` is deferred without reading any text. Otherwise texts are read 20 files at a time
  (`textsOf`, id/name/text columns only, no entities) and each page's requests are saved, flushed and detached
  (`src/features/kb-pipeline/db/session.ts`)
  before the next; if the exact estimate ends up over budget, the subject's saved requests are deleted and it is
  deferred. A stage therefore holds at most one page of raw text plus the run's budget worth of requests.
- **PLAN/WRITE/RETRY** read file names via a projection; WRITE reads raw text only for the changed files the
  subject's operations cite. Built requests are detached after each subject.
- **Submit:** the stage JSONL is read 50 requests per transaction and built in memory, then uploaded. The batch file is
  built in memory from a paged iterator (100 requests per transaction) and uploaded; requests are marked SUBMITTED
  with bulk updates (no entity loaded). Neither goes through a temp file, so a stage's JSONL is held whole in memory
  while it is uploaded.
- **Executing a stage never loads its rows whole.** Ids first (`idsBy...` in `src/features/kb-pipeline/db/repo.ts`), then rows in pages of 200
  that are flushed and detached (`KbRunEngine.forPages`), or count/aggregate queries:
  - SYNC (`runSyncJobs`): `SyncLlmExecutor.run(Iterator)` pulls the next request (a page of `2 x concurrency` params is
    read from the DB at a time) only when a slot is free; the output audit copy is built in memory.
  - BATCH (`collectBatch`): output and error files are downloaded into memory and parsed line by line; results are
    recorded 100 per transaction (idempotent: answered requests are skipped on a retry); the audit copy is stripped of
    `reasoning_content` line by line and stored from memory.
  - the cost check sums `est_tokens` and `max_tokens` per model in SQL (`pendingEstimate`); leftover/retry handling and
    `after()` page by id (DIGEST stored in id order, a file's chunks being consecutive; PLAN/WRITE/RETRY one subject's
    rows at a time).
  - Still per run (not per request): the run's subjects with their inputs/drafts. Bounded by the subject count.
- **Dry runs** go through the same chunked build (their JSONL is what staff inspect), so their memory is bounded the
  same way; the preview/forecast estimates never touch the texts.
- **PDF extraction** (`src/features/drive/logic/pdfText.ts`, unpdf in the Drive content worker pool) stops at
  `MAX_TEXT_CHARS` (1M) of text; the PDF itself is held in memory (`DRIVE-PARITY.md`).
- **Restart-loop guard:** at startup `KbPipelineJob#onStartup` resumes each active run through
  `KbRunEngine.registerResume` (`src/features/kb-pipeline/engine.ts`). A RUNNING run (one that was advancing a stage when the process stopped; WAITING and
  BLOCKED runs are not counted) increments `kb_run.resume_count` inside a 30-minute window
  (`resume_window_start`, V49); the counter resets when the run finishes a stage. After `MAX_RESUMES` (3) resumes in
  the window the next startup marks the run FAILED ("detenida tras reinicios repetidos (posible falta de memoria)")
  and its subjects failed, instead of resuming into another crash. The periodic sweep does not count.
- **Memory limit:** the API container is limited to 1G (`API_MEMORY_LIMIT` in `docker-compose.yml`); Docker kills it
  above the limit and `restart: unless-stopped` brings it back.
