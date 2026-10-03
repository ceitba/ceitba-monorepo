# Wiki pipeline: admin, cost and evaluation framework

Lets STAFF choose the models for each pipeline stage at runtime, see what the pipeline costs, and compare models with
evidence before switching. It builds on `docs/SUBJECT-WIKI-PIPELINE.md`. All endpoints are under `/api/v1/staff/kb/…`
and require the STAFF role.

## 1. Runtime settings (no redeploy to change a model)

`wiki.kb_pipeline_settings` holds a single row that overrides the env defaults, plus
`wiki.kb_pipeline_settings_history (id, settings jsonb, changed_by uuid, changed_at, note)` for audit and rollback.

| Field | Default (env) | Notes |
|---|---|---|
| `modelDigest` | `KB_MODEL_DIGEST` (glm-5.3-flash) | |
| `modelPlan` | `KB_MODEL_PLAN` (glm-5.3) | |
| `modelWrite` | `KB_MODEL_WRITE` (glm-5.3) | |
| `modelRetry` | `KB_MODEL_RETRY` (= write) | |
| `executionMode` | `auto` | `auto`, `batch` or `sync`; `batch` is rejected for models without batch support |
| `enabled` | `KB_PIPELINE_ENABLED` | weekly schedule on or off |
| `cron` | `KB_PIPELINE_CRON` (`0 0 3 * * SUN`) | Spring cron, **6 fields with seconds first**, America/Argentina/Buenos_Aires. A standard 5-field expression is accepted on PUT and stored/returned with `0 ` prepended (`0 3 * * SUN` → `0 0 3 * * SUN`) |
| `runTokenBudget` | `KB_RUN_TOKEN_BUDGET` | |
| `weeklyCostLimitUsd` | null | hard stop: a run is not submitted if its estimate exceeds this |
| `retryRejected` | `KB_RETRY_REJECTED` | |
| `subjectOverrides` | `{}` | `{ "<subjectId>": { modelWrite?, modelPlan?, paused?: bool } }` |
| `reasoningEffort` | `{digest: low, plan: low, write: medium, retry: medium}` | §8 |
| `maxTokens` | `{digest: 4000, plan: 6000, write: 12000, retry: 12000}` | 256..32000 each |
| `autoRefreshPrices` | `true` | refresh prices from DO's catalog (`POST /models/sync`) right before each scheduled run |

Endpoints:
- `GET /settings`, `PUT /settings` and `POST /settings/history/{id}/restore` all return the envelope
  `{ settings: { …every field, effective value }, source: { <field>: "env"|"db" }, updatedAt, updatedBy, updatedByName, costImpact }`.
  `costImpact` is `null` on GET.
- `PUT /settings` with the body `{ …fields, note }` (a field set to `null` goes back to its env default). It validates the
  models that change against the catalog (enabled, probed, and the mode is supported). `costImpact` is
  `{ previous, projected }`, each a `weekly` object of the forecast (§7) for the current and the new settings.
- `GET /settings/history` returns `[{ id, settings, changedBy, changedByName, changedAt, note }]`, newest first; each entry
  is a saved version (the stored overrides), and a restore saves it again as a new version.
- Changes take effect at the next stage submission. A stage that is already running keeps the model it started with,
  and the model is recorded per batch or request.

## 2. Model catalog and prices

`wiki.kb_model` replaces the plain price table:
`id (DO model id), displayName, provider, batchSupported bool, toolCalling (unknown|yes|no), enabled bool, inputPerM, outputPerM,
cacheReadPerM, batchDiscount (0..1), contextWindow, notes, pricesUpdatedAt, lastProbe jsonb`.

- Seeded with the models listed in the pipeline doc. STAFF can edit prices or enable and disable models
  (`GET /models`, `PUT /models/{id}`, `POST /models` to add one).
- `POST /models/sync` reads DigitalOcean's **public, unauthenticated** model catalog
  `GET https://api.digitalocean.com/v2/gen-ai/models/catalog` (items with `model_id`, `name`, `creator`, `context_window`,
  `max_output_tokens`, `capabilities[]`, `availability[]`, `pricing`):
  - **Unit trap:** the `pricing.*_price_per_million` fields (`input_price_per_million`, `output_price_per_million`,
    `cache_read_input_price_per_million` or `input_cache_read`) hold **per-token** prices (glm-5.3 input `1.4e-06`).
    Defensive rule: a value below 0.01 is per token and is multiplied by 1e6; otherwise it is taken as already per
    million. Which case applied is logged.
  - For each existing model matched by `model_id`: updates `inputPerM`, `outputPerM`, `cacheReadPerM`, `contextWindow`,
    `maxOutputTokens`, `displayName` (unless staff edited it with `PUT /models/{id}`) and `provider` (from `creator`); sets
    `pricesUpdatedAt` and `priceSource: "do-catalog"`. Every change is written to
    `wiki.kb_model_price_history (model_id, field, old_value, new_value, changed_at, source)` (`do-catalog`; price edits
    through `PUT /models/{id}` are recorded with `manual`).
  - Missing serverless chat models are added **disabled**, with prices; `batchSupported` follows the rule.
  - `capabilities` are hints only (Haiku lists none but calls tools): `reasoning` sets `supportsReasoningEffort` only when
    no probe has run; `tool_calling` sets `toolCalling: yes` only while it is `unknown`. Probes win.
  - Never touched: `batchDiscount`, a probe's `batchSupported`, `enabled`, and past run costs (frozen prices).
  - The catalog has no batch information: batch support stays rule + probe.
  - Response: `{ updated: [{ id, changes: [{ field, old, new }] }], added: [ids], unchanged, notInCatalog: [ids],
    source: "do-catalog"|"inference-models", fetchedAt }`. If the catalog is unreachable it falls back to the inference
    `GET /v1/models` (ids only, added disabled, no prices) with `source: "inference-models"`.
  - With `autoRefreshPrices` (default true) the same sync runs before each scheduled pipeline run.
- `GET /models` items also carry `maxOutputTokens` and `priceSource` (`do-catalog` | `manual` | null for seed prices).
- `POST /models/{id}/probe` runs the probe from the pipeline doc and stores the result in `lastProbe`
  (mode, whether tool calling worked, latency, usage). A model can't be selected in the settings until a probe has succeeded.
- All costs are computed from recorded token usage multiplied by the catalog price **at the time of the run**, and stored
  on the run. Changing a price later doesn't rewrite history. `GET /costs?reprice=true` shows past runs at today's prices.

## 3. Cost analytics

- Every HTTP call records `model, mode, stage, subjectId, inputTokens, cachedInputTokens, outputTokens, costUsd` in
  `wiki.kb_llm_usage`, plus `attempt` (1-based within the request: the json_object fallback and the doubled-max_tokens
  retry are separate rows), `latency_ms` (sync) and `reasoning_tokens` (when the API reports
  `completion_tokens_details.reasoning_tokens`). Aggregate queries run over it.
- `GET /costs?from&to&groupBy=week|model|stage|subject` returns rows of `{ key, inputTokens, cachedInputTokens, outputTokens, costUsd, requests }`.
- `GET /costs/summary` returns:
  - `{ last7dUsd, last30dUsd, projectedMonthUsd, byStage, byModel, topSubjects }`;
  - `cacheHitRatio`: cached input tokens over total input tokens.
- Runs list and detail as in the pipeline doc, plus the cost per stage and per subject.
- Alert: when a run's estimate exceeds `weeklyCostLimitUsd`, the run stops at that stage with
  status `BLOCKED_BY_COST_LIMIT`, and staff can approve it once with `POST /runs/{id}/approve-cost`.

## 4. Evaluation framework

Goal: compare models on the **same inputs** with automatic metrics and blind human ratings, and keep a leaderboard over time.

### Benchmark sets
`wiki.kb_eval_set (id, name, subjectIds[], createdBy, createdAt, frozenInputs jsonb)`.
- A set freezes the subjects' current inputs (file ids and fingerprints, plus the digests used), so later runs of the set are
  comparable even when the Drive content changes. Digests are reused, never regenerated, unless the set is re-frozen explicitly.
- Default seed: "Básico" with 81.07, 61.81 and 93.39 (one large, one medium, one small).

### Evaluation runs
- `POST /evals {setId, models: [{ plan, write, reasoningEffort?: { plan?, write? } }], note}` runs PLAN and WRITE as a full rebuild per subject, for each model
  configuration. It reuses the frozen digests, never publishes, and stores the pages under `kb/evals/<evalId>/<configKey>/<subject>/<slug>.md`.
- This is the explicit, staff-triggered exception to the "no re-reading" rule (it only re-sends digests and the frozen
  excerpts, never new Drive reads). Its tokens are recorded in `kb_llm_usage` with `stage = EVAL`.
- It goes through the same executor, so it uses batch where supported and is charged at the same discounted price.

### Automatic metrics (per configuration × subject, plus the totals)

| Metric | How it's measured |
|---|---|
| `firstPassValidRate` | pages accepted by the validator on the first try / pages written |
| `finalValidRate` | after one retry |
| `rejectReasons` | counts of each validator error type |
| `citationDensity` | citations per `##` section (avg) |
| `uncitedSections` | should be 0 after validation; counted on the first pass |
| `coverageViolations` | mentions of a same-subject page left unlinked, before the linker runs |
| `copyViolations` | 40-word overlaps found on the first pass |
| `unsupportedClaimsRate` | **grounding check (deterministic)**: each sentence that has a number, formula or proper noun is checked for a lexical anchor in the cited sources' text or digests; the share without one. A heuristic, labelled as such |
| `pagesPlanned` / `pagesWritten` / `avgWords` | size and structure |
| `crossLinks`, `anchors` | link richness |
| `inputTokens`, `outputTokens`, `costUsd`, `costPerValidPage` | cost |
| `durationSec` | wall time, including batch wait |

### Blind human review
- `GET /evals/{id}/review/next?subjectId&slug`: the same page written by two configurations, labelled A and B in random
  order, with the model names hidden.
- `POST /evals/{id}/review`: `{ subjectId, slug, winner: A|B|tie, scores: { accuracy 1-5, clarity 1-5, usefulness 1-5 }, comment }`.
  The labels are mapped back to configurations on the server.
- `wiki.kb_eval_rating` stores the ratings, one per reviewer per page pair.

### Leaderboard
A configuration is identified by `configKey` = `plan[@effort]|write[@effort]`, e.g. `glm-5.3@low|glm-5.3@medium` or
`anthropic-claude-haiku-4.5|anthropic-claude-haiku-4.5` (the `@effort` part only when a reasoning effort was given).

`GET /evals/leaderboard?setId` (default: "Básico") aggregates every completed eval of a set, per model configuration, and
returns an envelope:
```
{ setId, setName,
  entries: [{ configKey, plan, write, reasoningEffort: { plan?, write? } | null,
              evals, ratings, wins, losses, ties, winRate: number|null,
              avgScores: { accuracy, clarity, usefulness },     // each number|null
              metrics: { …the automatic metrics, summed/weighted over the evals },
              costUsd, costPerValidPage, smallSample }] }      // smallSample: ratings < 20
```
Entries are sorted by `winRate` (no ratings last), then by `costPerValidPage`. It includes:
- win rate (Bradley-Terry or plain win% with tie = ½, whichever is simpler);
- average human scores;
- automatic metrics;
- costPerValidPage;
- the number of ratings, so a small sample can be flagged in the UI.

`POST /evals/{id}/promote {configKey}` copies that configuration's models into the runtime settings (same validation and
history as `PUT /settings`). It's a convenience; nothing is promoted automatically.

## 5. Tests
- Settings validation (unknown, disabled or unprobed model; batch on a sync-only model); history and restore.
- Cost math: batch discount, cached tokens, frozen prices.
- Eval: frozen inputs reused (no new digests, and an assertion on the payloads), no publishing, metrics computed on a fixture.
- Blind review: labels are randomized and resolved on the server.
- Leaderboard aggregation.

## 6. Contract additions (agreed with the admin frontend)

These complete sections 1–4; the frontend already calls them.

- **Multi-dimension grouping:** `GET /costs?from&to&groupBy=week,stage` (also `week,model`). Each row is
  `{ week, stage?, model?, subjectId?, inputTokens, cachedInputTokens, outputTokens, costUsd, requests }`, with `week` = ISO date
  of the Monday in America/Argentina/Buenos_Aires.
- **Cost impact before saving:** `POST /settings/preview` takes the same body as `PUT /settings`, returns
  `{ costImpact: { previous, projected }, errors: [] }` (each a forecast `weekly` object, §7) and persists nothing.
- **Runs** live under `/pipeline/runs…` (pipeline doc). `POST /pipeline/runs/{id}/approve-cost`. The run detail adds
  `costUsd`, `costByStage: { DIGEST, PLAN, WRITE, RETRY }`, per-subject `costUsd`, and per-batch `costUsd`.
- **Benchmark sets:** `GET /evals/sets`, `POST /evals/sets { name, subjectIds }` (it freezes the inputs on creation), and
  `POST /evals/sets/{id}/refreeze`.
- **Evals:**
  - `GET /evals` and `GET /evals/{id}`. The detail is `{ id, setId, status, createdAt, configs: [{ configKey, plan, write, status, metrics, perSubject: [...] }] }`.
  - `POST /evals/estimate { setId, models }` returns `{ estimatedInputTokens, estimatedOutputTokens, estimatedCostUsd }`.
- **Blind review:**
  - `GET /evals/{id}/review/next?subjectId&slug` returns `{ subjectId, slug, remaining, a: Page, b: Page }`, where `Page` is
    `{ title, markdown, sources, links }`. `sources` and `links` have the reader's `Page.sources` / `Page.links` shapes:
    `{ id, name, kind, academicYear, academicYearSource, author: { name, anonymous } }` and
    `{ raw, subjectId, slug, anchor, resolved, title }` (a link resolves to a page the same configuration wrote, or to a
    live page). It returns 204 when nothing is left to review.
  - `POST /evals/{id}/review { subjectId, slug, winner: A|B|tie, scoresA: { accuracy, clarity, usefulness }, scoresB: {…}, comment }`.
    Scores are **per side**, 1–5 each. The response includes `revealed: { A: { configKey, plan, write }, B: {…} }`.
- **Probe:** `lastProbe` is `{ ok: boolean, mode: batch|sync, toolCalling: yes|no, latencyMs, usage, error?, at }`.

## 7. Expected costs and effective (batch) pricing

### Effective price
- The catalog stores **list prices** plus `batchSupported` and `batchDiscount` (default 0.5, editable).
- **Default rule:** OpenAI and Anthropic *commercial* models only; DO-hosted open-weight models (GLM, DeepSeek, Qwen, Kimi, gpt-oss, Llama…) are `false`.
- **Probe overrides the rule:** a successful batch probe sets `batchSupported=true` with `batchVerifiedAt`; a batch probe rejected for that model sets it `false`.
- Every price shown or used for an estimate is the **effective price** for a stage:
  - `effective = list × (1 − batchDiscount)` when the stage would run in BATCH (execution mode `batch`, or `auto` and `batchSupported`);
  - otherwise `effective = list`.
  - Cached input uses `cacheReadPerM`; the batch discount applies to it too when batched.
- `GET /models` items add `effectivePrices: { batch: { inputPerM, outputPerM, cacheReadPerM } | null, sync: { … } }` and
  `batchSource: rule|probe`.
- DO advertises the batch discount as "up to 50%". Estimates using it are flagged `discountIsEstimate: true` until
  `batchDiscount` has been calibrated against real billing.
- Calibration: `PUT /models/{id}` with `batchDiscount` and `batchDiscountVerified: true`.

### Expected costs
`GET /costs/forecast` returns:
```
{
  settingsHash,
  nextRun: { dirtySubjects, perStage: { DIGEST|PLAN|WRITE|RETRY: { model, mode, inputTokens, cachedInputTokens, outputTokens, costUsd } }, totalUsd },
  weekly: { expectedUsd, low, high, basis: "history"|"corpus"|"blend", runsUsed, includesBacklog },
  monthly: { expectedUsd, low, high },
  fullRebuild: { inputTokens, outputTokens, costUsd },          // regenerate every wiki from digests (e.g. after a model switch)
  savings: { batchUsd, cacheUsd },                               // vs. list price without batch/cache, for the expected week
  limits: { weeklyCostLimitUsd, exceedsLimit: boolean },
  discountIsEstimate: boolean
}
```
- `nextRun` is the pipeline preview (dirty subjects and their real added/changed/removed sizes) priced with the current settings.
  Tokens are estimated as chars/3.5 for input. Output uses per-stage ratios learned from past requests (stored per model and stage,
  e.g. median outputTokens per request), with defaults of digest 600, plan 1500 and write 2500 tokens per request until there's history.
- `weekly`:
  - **history:** the median of the last 8 completed scheduled runs, *re-priced with the current settings*, with p25–p75 as the range;
  - **corpus:** with fewer than 3 runs, estimate from the weekly change rate of published files (the files whose fingerprint
    changed per week over the last 4 weeks), times the average tokens per file;
  - **blend:** both, weighted by the number of runs.
- **Backlog floor:** when there are dirty subjects, `weekly` (expected, low, high) and `monthly` are never below
  `nextRun.totalUsd`; `includesBacklog: true` says the floor kicked in. `basis` still names the estimate's method.
- `?settings=<json>` (or `POST /costs/forecast` with a settings body) computes the same forecast for **proposed** settings. It
  powers the settings dialog and the model picker. `POST /settings/preview` returns this forecast as `costImpact`
  `{ previous: forecast.weekly, projected: forecast.weekly }`.
- `GET /models/{id}/stage-cost?stage=` (`digest|plan|write|retry`, case-insensitive; returned lowercase) returns the expected weekly cost if this model were used for that stage, everything else
  unchanged. It's used to show a cost next to each option in the model picker.

### Actuals vs expected
- Each completed run stores `expectedCostUsd` (the forecast at submission) next to `costUsd` (actual).
- `GET /costs/summary` adds `accuracy: { lastRuns: [{ runId, startedAt, trigger, expectedUsd, actualUsd }] }`, so admins can see how good the estimates are.

## 8. Reasoning effort and structured-output reliability (field shapes)

- **Settings:** `reasoningEffort: { digest?, plan?, write?, retry? }`, each `low|medium|high|null`. `null` means the model default.
  Defaults: `low` for GLM digest and plan, `medium` for write.
- **Eval model config:** `{ plan, write, reasoningEffort?: { plan?, write? } }`. The effort is part of `configKey`, e.g.
  `glm-5.3@low|glm-5.3@medium`.
- **Catalog item:** `supportsReasoningEffort: boolean` and `emptyToolCallRate: number|null`, computed over that model's last
  200 structured requests.
- **Eval metrics** add `emptyToolCallRate`.
- `GET /models/{id}/stage-cost?stage=` returns `{ stage, model, mode, expectedWeeklyUsd, low, high, basis }`.

## Progress (runs and evals)

`GET /pipeline/runs/{id}` and `GET /evals/{id}` include `progress`; `GET /pipeline/runs/{id}/progress` and
`GET /evals/{id}/progress` return just that object (cheap, for polling every few seconds):
```
progress: {
  stages: [{ stage: "DIGEST"|"PLAN"|"WRITE"|"RETRY"|"LINK"|"VALIDATE"|"PUBLISH",
             status: "pending"|"running"|"waiting_batch"|"done"|"failed"|"skipped",
             total, done, failed, inFlight,       // requests; LINK/VALIDATE: pages; PUBLISH: subjects
             mode: "sync"|"batch"|null,
             batch: { doStatus, requestCounts: { total, completed, failed }, submittedAt } | null,
             startedAt, finishedAt }],
  overall: { done, total, percent },              // estimated input tokens, not request counts
  current: "Generando resúmenes de archivos (7/11) con glm-5.3-flash",
  etaSec: number|null,
  lastActivityAt,
  stalled: boolean
}
```
- **Totals:** DIGEST = chunks needing a digest (known when the stage starts); PLAN = subjects (× configurations for an
  eval), known up front; WRITE is `null` until PLAN finishes (the UI shows "por determinar"); RETRY is `null` until WRITE
  finishes. `failed` includes answers that failed and wait for the stage's single resubmission.
- **Batch stages** take `done`/`failed` from DO's `request_counts` (`GET /v1/batches/{id}`, stored at each poll) while
  the batch is open.
- **overall** weights each request by its estimated input tokens; stages not built yet are estimated (PLAN: 6k tokens
  per request; WRITE: 4 pages per PLAN request × 9k; RETRY: 15% of the pages × 11k), so it firms up once WRITE is known.
- **etaSec** (sync only, null while waiting for a batch): remaining requests (current and later stages, estimated as
  above) × the average `latency_ms` of the last 10 answers ÷ the in-flight concurrency; without latencies, the average
  gap between the last completions.
- **lastActivityAt:** the last answer, batch status change or stage transition. **stalled:** active and no activity for
  10 min (sync) or 26 h (batch).
- **Evals:** DIGEST is shared by all configurations and appears only at the top level. Each `configs[]` adds
  `progress: { done, total, percent, stage }` (its PLAN/WRITE/RETRY requests), and each `configs[].perSubject[]` adds
  `status` (`pending|planning|writing|validating|done|failed|cancelled`, lowercase), `pagesPlanned`, `pagesWritten` and
  `pagesValid`. PUBLISH is always `skipped` for evals; the eval's REPORT step shows as VALIDATE.
- Each stage transition is logged once at INFO (`KB eval|run <id>: DIGEST -> PLAN (RUNNING; 11 requests: 11 done,
  0 failed)`) and stored in `kb_run.stage_log` (`{ "<STAGE>": { startedAt, finishedAt } }`).

**Cancel** (`POST /pipeline/runs/{id}/cancel`, `POST /evals/{id}/cancel`) cascades: open DO batches are cancelled;
queued sync requests are abandoned (answers to requests already in flight are still recorded in usage, since they are
paid for, but never applied); unfinished eval configurations become `CANCELLED` and their subjects `cancelled`.

## Blind review progress

`GET /evals/{id}/review/progress` (and `reviewSummary` in `GET /evals/{id}` once the eval succeeded, same shape):
```
{ totalPairs, reviewedByMe, reviewedByAnyone, remainingForMe,
  perSubject: [{ subjectId, subjectName, totalPairs, reviewedByMe, reviewedByAnyone }],
  ratingsPerConfig: [{ configKey, plan, write, ratings }],
  minRatingsForConfidence: 20, confident: boolean }
```
A pair is one (subject, slug) written by two configurations; `confident` is true when every configuration has at least
`minRatingsForConfidence` ratings. `review/next` also returns `reviewedByMe` and `totalPairs`.

## Date parameters and parameter errors

- Every `from` / `to` query parameter of the staff kb endpoints (today only `GET /costs`; runs, evals and the summary
  take none) accepts either:
  - a date `YYYY-MM-DD`, read in America/Argentina/Buenos_Aires: `from` is the start of that day (00:00) and `to` the
    end of it (23:59:59.999999999), so `from=2026-07-11&to=2026-07-11` is that whole day, both ends inclusive;
  - a full ISO datetime with offset, e.g. `2026-07-11T00:00:00-03:00` or `2026-07-11T03:00:00Z` (URL-encode the `+` of
    a positive offset).
- Defaults: `from` = 30 days ago, `to` = now. `from` after `to` is a 400.
- A malformed value (or any wrong-typed parameter on these endpoints: a bad UUID, a non-numeric `limit`) is
  `400 { error: "ValidationError", message: "<param>: ..." }`, never a 500 or a raw conversion message.
- `GET /costs` rows always carry `key`: the value of the single `groupBy` dimension (§3), or the values joined with
  `|` in `groupBy` order for several (`"2026-09-28|WRITE"`), next to the named fields of §6.

## Implementation notes and deviations

- All paths are under `/v1/staff/kb` (STAFF only). Extra: `POST /evals/{id}/cancel`,
  `GET /evals/{id}/pages?configKey&subjectId&slug` (a page as the reviewer sees it).
- **Settings** keys for `reasoningEffort` and `maxTokens` are lowercase stages (`digest|plan|write|retry`).
  Validation only checks models that change (an unprobed env default doesn't block unrelated edits). `modelRetry`
  follows `modelWrite` unless set. History stores each saved version (newest first); restore saves it again as a new
  version.
- **Batch support from a probe** is set to `false` only when the error explicitly says the model or provider doesn't
  support batch (a 4xx whose code or message says so, e.g. `model_not_supported`). Any other failure (bad file name,
  account blocked, rate limit, 5xx) leaves `batchSupported` and `batchSource` untouched. A staff edit of
  `batchSupported` resets `batchSource` to `rule`.
- **Probe.** `lastProbe` always has `ok, mode, toolCalling, latencyMs, usage, at` (§6); without an answer (account
  error, pending or failed batch) `toolCalling` is `"no"` and usage is zero, and the catalog's own `toolCalling` is left
  unchanged. Extra keys: `path` (tool | content-json | json_object | text), and `pending` / `batchId` while a batch
  probe waits. Batch support follows the rule above. A batch probe on a model without a batch provider (GLM,
  DeepSeek...) is not attempted: `lastProbe` records `{ok:false, mode:"batch", error}` and `batchSupported` stays false. Batch probes complete on the poller
  (`refreshPendingProbes`). Prompt-token overhead differs per provider: the same tiny probe counted 752 prompt tokens
  on Anthropic Haiku vs 240 on GLM (tool schema framing); the forecast uses a flat 1,500-token overhead per request.
- **Catalog.** `openai-gpt-oss-120b` is `batchSupported=false` by rule (open-weight on DO). `emptyToolCallRate` is
  computed over the model's last 200 answered or failed requests.
- **Eval sets** freeze file ids, fingerprints, digest ids and each file's text (`kb/evals/sets/<setId>/<fileId>.txt`);
  "Básico" is created at startup with whichever of 81.07, 61.81, 93.39 exist. Evals run as a full rebuild per config
  (DIGEST only for missing digests, shared), validate against the frozen inputs, store pages under
  `kb/evals/<evalId>/<configKey>/<subject>/<slug>.md` (in the storage key `|` becomes `__` and `@` becomes `_at_`)
  and record usage with stage `EVAL`. Eval metrics include `claimsChecked` and `groundingIsHeuristic: true` next to
  `unsupportedClaimsRate` (a sentence with a number, formula or proper noun is unsupported when none of those anchors
  appears in its cited sources' text or digests). Review scores are optional per field (1-5).
- **Leaderboard** without `setId` uses "Básico"; ranked by win rate (ties count ½), then cost per valid page;
  `smallSample` below 20 ratings.
