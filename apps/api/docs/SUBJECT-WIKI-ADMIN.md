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
| `cron` | `KB_PIPELINE_CRON` (`0 0 3 * * SUN`) | Spring-syntax cron (parsed by `src/features/kb-admin/cron.ts`), **6 fields with seconds first**, America/Argentina/Buenos_Aires. A standard 5-field expression is accepted on PUT and stored/returned with `0 ` prepended (`0 3 * * SUN` → `0 0 3 * * SUN`) |
| `runTokenBudget` | `KB_RUN_TOKEN_BUDGET` | at most `KB_RUN_TOKEN_BUDGET_MAX` (50M): PUT refuses more, a larger stored value is clamped when used |
| `runCostBudgetUsd` | `KB_RUN_COST_BUDGET_USD` (5.00) | US$ 0.10 to 100 (PUT refuses others): the estimated cost a run may take on. Admission (pipeline doc, "Cost budget and admission") defers subjects whose whole estimated cost (DIGEST of uncached files + PLAN + WRITE + RETRY at effective prices) does not fit, smallest first. `runTokenBudget` stays as a secondary cap. Returned in `values` and `source` like the other fields |
| `weeklyCostLimitUsd` | null | hard stop: no stage is submitted while the pipeline's recorded cost of the last 7 days plus that stage's estimate exceeds this |
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
  - Field types are checked: `enabled`/`retryRejected`/`autoRefreshPrices` booleans, `runTokenBudget` a whole number,
    `runCostBudgetUsd`/`weeklyCostLimitUsd` numbers, `subjectOverrides`/`reasoningEffort`/`maxTokens` objects, the rest strings; anything
    else is `400 ValidationError` naming the field (`"25"` is not read as 0, `"yes"` not as false).
  - Keys that are not settings fields (`costImpact`, `source`, `updatedAt`, `updatedBy*`, …: the envelope echoed back)
    are ignored.
  - A value that changes no effective setting (e.g. equal to the env default) is not stored: the field stays
    `source: "env"`, so resending the whole object never freezes the env defaults.
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

## Custom OpenAI-compatible endpoints (own GPU)

Staff can point the pipeline at their own server (llama.cpp `llama-server`, vLLM, ...) from the admin UI, with no
env change. Models of an endpoint are catalog models with id `custom:<endpointName>:<modelSlug>`, provider `custom`, `batchSupported=false`, price 0 (editable like any price). They work
in every stage, evals and probes; `auto`/`batch` modes always run them sync. The catalog id is slash-free (the
`/models/{id}` routes would otherwise need `%2F`, which the API rejects with 400): `modelSlug` is the raw model id with every
character outside `[A-Za-z0-9._-]` replaced by `-`, truncated to fit the 128-char id (a short hash suffix tells apart
two raw ids that slug alike). The raw id the endpoint knows is stored in `kb_model.remote_model_id` (V52), returned
as `remoteModelId` by the model endpoints and sent in the request body. Runs and evals need `KB_LLM_API_KEY` only
when some stage model is a DigitalOcean model. Manually created or DO-synced catalog ids must match
`[A-Za-z0-9._:-]+` (and `custom:*` ids only come from discovery).

Table `wiki.kb_llm_endpoint` (V51): `name` (unique, `[a-z0-9-]`, not renamable), `base_url` (http/https; **includes
`/v1`**, e.g. `http://host:8081/v1`; calls go to `{baseUrl}/chat/completions` and `{baseUrl}/models`),
`api_key_encrypted`, `max_concurrency` (1-64, default 2), `timeout_sec` (5-3600, default 600 = PT10M), `enabled`.

Staff API, all under `/v1/staff/kb/endpoints` (STAFF only):

| Call | Body / result |
|---|---|
| `GET /` | `[{id, name, baseUrl, hasKey, keyReadable, maxConcurrency, timeoutSec, enabled, modelCount, createdAt, updatedAt}]` |
| `POST /` | `{name, baseUrl, apiKey?, maxConcurrency?, timeoutSec?, enabled?}` -> item |
| `PUT /{id}` | same, all optional; `apiKey` omitted = keep, `""` = remove -> item |
| `DELETE /{id}` | 204; 409 `KB_ENDPOINT_IN_USE` while a model of it is in the settings (incl. subject overrides) or in an active run/eval; also deletes its catalog models |
| `POST /{id}/test` | `GET {baseUrl}/models` -> `{ok, latencyMs, models[], error?}` |
| `POST /{id}/discover` | lists the models and adds `custom:<name>:<slug>` (disabled until staff enable them; existing ones untouched) -> `{added[], existing[]}` |
| `GET /{id}/stats?minutes=60` | `{windowMinutes, requests, errors, p50Ms, p95Ms, outputTokensPerSec, inFlight}` |

Workflow: add endpoint -> test -> discover -> enable the model and set its prices -> probe it (sync) -> select it in
the settings or an eval (both need an enabled model with a successful sync probe).

**The token is write-only and set from the UI.** It is encrypted with AES-256-GCM before it is stored and is never
returned or logged (responses only say `hasKey`). The key is derived with HKDF-SHA256 from `AUTH_JWT_SECRET` (info
`ceitba-kb-endpoint-keys-v1`), so nothing needs to be configured. Optional override: `KB_SECRETS_KEY` (base64 of 32
bytes, `openssl rand -base64 32`); when set, new tokens use it, and tokens saved before stay readable (each stored
value is prefixed `v1:jwt:` or `v1:env:` with the key source). **Rotating `AUTH_JWT_SECRET`** (or changing/removing
a `KB_SECRETS_KEY` that encrypted tokens) makes the stored tokens undecryptable: the endpoint then shows
`hasKey: true, keyReadable: false`, `test` answers `ok: false` with "re-enter the token", and requests fail with
that error until the token is saved again.

Routing and limits: each endpoint has its own semaphore of `max_concurrency`, independent of `KB_SYNC_CONCURRENCY`
(which only paces DigitalOcean); a stage on a custom model runs at most that many requests at once, shared by runs,
evals and probes. `reasoning_effort` is sent only if the model's `supportsReasoningEffort` (false by default for
custom models). Tools need `--jinja` on llama.cpp: when the probe says `toolCalling: no` (or the server refuses the
tool request with an HTTP error) the executor uses the `json_object` fallback directly.

Stats (stress testing): `requests`, `p50Ms`/`p95Ms` and `outputTokensPerSec` come from `kb_llm_usage` sync rows of
`custom:<name>:%` in the window (`outputTokensPerSec` = output tokens / summed latency, i.e. per-request speed, not
aggregate throughput). Failed calls leave no usage row: they are counted in memory (since the last API restart) and
added to `requests` and `errors` (`errors` also counts answers with 0 output tokens). `inFlight` is the in-memory
count of HTTP calls running now.

Limits: the DO key gate (`KB_LLM_API_KEY`) still applies to starting a run or an eval, even if all models are
custom. Model ids with `/` in catalog URLs (`/models/{id}/probe`) need the SPA to encode them as `%2F`, which the
API rejects with 400 (`src/http/app.ts`); probe them from the endpoint-aware UI path once an alias exists.

## 3. Cost analytics

- Every HTTP call records `model, mode, stage, subjectId, inputTokens, cachedInputTokens, outputTokens, costUsd` in
  `wiki.kb_llm_usage`, plus `attempt` (1-based within the request: the json_object fallback and the doubled-max_tokens
  retry are separate rows), `latency_ms` (sync) and `reasoning_tokens` (when the API reports
  `completion_tokens_details.reasoning_tokens`). Aggregate queries run over it.
- `GET /costs?from&to&groupBy=week|model|stage|subject` returns rows of `{ key, inputTokens, cachedInputTokens, outputTokens, costUsd, requests }`.
  The range spans at most 366 days (400 otherwise).
- `GET /costs/summary` returns:
  - `{ last7dUsd, last30dUsd, projectedMonthUsd, byStage, byModel, topSubjects }`;
  - `cacheHitRatio`: cached input tokens over total input tokens.
- Runs list and detail as in the pipeline doc, plus the cost per stage and per subject.
- Alert: when the pipeline's recorded cost of the last 7 days plus the estimate of a stage about to be submitted exceeds
  `weeklyCostLimitUsd`, the run stops at that stage with status `BLOCKED_BY_COST_LIMIT`, and staff can approve it once
  with `POST /runs/{id}/approve-cost` (for the rest of that run).

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
  - **history:** the median of the last 8 completed scheduled runs, *re-priced with the current settings*, with p25–p75 as the range,
    times the number of times the cron fires in a week (1 for the default weekly cron);
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
- A forecast reads the corpus once (inputs and their diffs, page sources per subject without bodies, catalog, learned
  ratios); `stage-cost` calls, which the model table makes for every (model, stage), share that snapshot for 30 s.

### Run budget (for the admin SPA)
- Every run response (`GET /pipeline/runs`, `.../runs/{id}`) carries `budget`: `{ limitUsd, estimatedUsd, spentUsd,
  admitted, deferred, deferredEstimatedUsd, tokenBudget, oversizedSubjectId }` (null on runs created before it).
  `estimatedUsd` is the admitted subjects' whole-run estimate, `spentUsd` the recorded cost so far, `limitUsd` the
  `runCostBudgetUsd` in force at detection. The SPA can show spent / estimated against limit and "N admitidas, M
  diferidas por presupuesto (US$ X)". A subject deferred for budget has `status: DEFERRED` and `error` starting
  with `presupuesto de la corrida (US$ X estimado)`.

### Actuals vs expected
- Each completed run stores `expectedCostUsd` (the forecast at submission) next to `costUsd` (actual).
- `GET /costs/summary` adds `accuracy: { lastRuns: [{ runId, startedAt, trigger, expectedUsd, actualUsd }] }`, so admins can see how good the estimates are.

## 8. Reasoning effort and structured-output reliability (field shapes)

- **Settings:** `reasoningEffort: { digest?, plan?, write?, retry? }`, each `low|medium|high|null`. `null` means the model default.
  Defaults: `low` for GLM digest and plan, `medium` for write.
- **Eval model config:** `{ plan, write, reasoningEffort?: { plan?, write? } | "low"|"medium"|"high" }`. A string applies to both
  stages; any other non-object type is a 400 `ValidationError`. The effort is part of `configKey`, e.g.
  `glm-5.3@low|glm-5.3@medium`.
- **Catalog item:** `supportsReasoningEffort: boolean` and `emptyToolCallRate: number|null`, computed over that model's last
  200 structured requests.
- **Eval metrics** add `emptyToolCallRate`.
- `GET /models/{id}/stage-cost?stage=` returns `{ stage, model, mode, expectedWeeklyUsd, low, high, basis }`.

## DigitalOcean quota

`GET /v1/staff/kb/quota[?refresh=true]` (STAFF). DO has no usage endpoint; the counters are the latest `x-ratelimit-*` headers
of any DO response, kept in memory (lost on restart; reset headers are always 0 and ignored). `refresh=true` runs the free
batch probe (`POST /v1/batches` with a nonexistent `file_id`: 404 with the batch headers, consumes nothing), at most once a minute.
```
{ observedAt: ISO|null,
  batch: { creationsPerHour: C, createPerMinute: C, requestsPerDay: C, statusChecksPerMinute: C },
  sync:  { tokensPerDay: C, tokensPerMinute: C, requestsPerMinute: C },
  stale: boolean }          // C = { limit, remaining } | null (never observed); stale = nothing seen in 10 min
```
Progress strings: `Esperando cupo de lotes de DigitalOcean: 0/5 esta hora; reintento a las HH:MM` (batch stage, job QUEUED) and, for
a run, `Cupo diario de tokens de DigitalOcean agotado; reintento a las HH:MM` (status WAITING, also in `run.error`).
A batch model probe waiting for a slot reports the same batch text in `lastProbe.error`.

## Progress (runs and evals)

`GET /pipeline/runs/{id}` and `GET /evals/{id}` include `progress`; `GET /pipeline/runs/{id}/progress` and
`GET /evals/{id}/progress` return just that object (cheap, for polling every few seconds):
```
progress: {
  stages: [{ stage: "DIGEST"|"PLAN"|"WRITE"|"RETRY"|"LINK"|"VALIDATE"|"PUBLISH",
             status: "pending"|"running"|"waiting_batch"|"done"|"failed"|"skipped",
             total, done, failed, inFlight,       // requests; LINK/VALIDATE: pages; PUBLISH: subjects
             mode: "sync"|"batch"|null,
             batch: { doStatus, requestCounts: { total, completed, failed }, submittedAt,
                      status,          // QUEUED (DO not called yet / creation rate-limited) | SUBMITTED | COMPLETED | FAILED | CANCELLED
                      error,           // DO's error_message of a failed batch, or RATE_LIMITED: ... while retrying
                      nextAttemptAt } | null,
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
- **Run status** in responses: `SUCCEEDED`, `PARTIAL` (some subjects/configurations failed; `current` = "Terminado con
  fallas: …"), `FAILED` (all failed), `CANCELLED`, plus the active ones.
- **Rate-limited batch creation** shows the stage as `waiting_batch` and `current` ends with "DigitalOcean limitó la
  creación de lotes; reintento a las HH:MM" (Buenos Aires time).
- **Batch stages** take `done`/`failed` from DO's `request_counts` (`GET /v1/batches/{id}`, stored at each poll) while
  the batch is open.
- **overall** weights each request by its estimated input tokens; stages not built yet are estimated (PLAN: 6k tokens
  per request; WRITE: 4 pages per PLAN request × 9k; RETRY: 15% of the pages × 11k), so it firms up once WRITE is known.
- **etaSec** (sync only, null while waiting for a batch): remaining requests (current and later stages, estimated as
  above) × the average `latency_ms` of the last 10 answers ÷ the in-flight concurrency; without latencies, the average
  gap between the last completions.
- **Ended runs:** a failed or cancelled run reports the stage it stopped at as `failed` (with `inFlight: 0`) and later
  stages as `skipped`; `overall` then counts only the stages that ran.
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
- Defaults: `to` = now, `from` = 30 days before `to` (so `?to=` alone is the 30 days up to it). `from` after `to`, or a
  range longer than 366 days, is a 400.
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
- **Batch model id.** `batchModelId` (nullable, editable with `PUT /models/{id}`; `null`/blank = default) is the id batch
  JSONL lines use; the default is the catalog id without its `openai-`/`anthropic-` prefix (DO's batch API rejected
  `openai-gpt-6-luna` as `unsupported model … not available on DigitalOcean` while sync accepts it). The models
  response has `batchModelId` (stored) and `effectiveBatchModelId` (what a batch sends). Sync always uses `id`.
- **Batch support from a probe.** A batch probe that DO refuses with "unsupported model" (at creation or in the failed
  batch's `error_message`) is retried once with the other id form (native ↔ prefixed); the form that works is stored in
  `batchModelId` with `batchSupported=true`. `batchSupported` turns `false` only when **both** forms are unsupported
  (`lastProbe.batch.unsupportedModel: true`, `triedErrors` = DO's message per id form, and `error` = "batch not
  available for this model on DigitalOcean: <form>: <DO message>; …"); the batch price then disappears from
  `effectivePrices`. Any other failure (bad file name, account blocked, 5xx) leaves
  `batchSupported` and `batchSource` untouched. A `429`/no answer on creation keeps the probe pending with `retryAt`
  (1, 5, 15, 60 min) and the poller resubmits it. At most one batch probe per model is pending: probing again returns
  the pending one. A staff edit of `batchSupported` resets `batchSource` to `rule`.
- **Probes per mode:** `lastProbe` keeps one entry per mode, `lastProbe.sync` and `lastProbe.batch`; its top level is the
  most recent probe (the §6 shape) for compatibility. A batch probe waiting for DO shows `pending: true`.
- **selectable** = enabled AND a successful probe in the mode the stage would actually use (`auto`: batch if
  `batchSupported`, else sync; `sync`: sync; `batch`: batch when supported). A pending (or missing) batch probe never
  blocks selection: the sync probe decides until the batch result arrives. `PUT /settings` uses the same rule.
- **Probe.** `lastProbe` always has `ok, mode, toolCalling, latencyMs, usage, at` (§6); without an answer (account
  error, pending or failed batch) `toolCalling` is `"no"` and usage is zero, and the catalog's own `toolCalling` is left
  unchanged. Extra keys: `path` (tool | content-json | json_object | text), `pending` with `batchId` (or `retryAt`,
  `retries` while creation is rate-limited) while a batch probe waits, and `batchModelId` / `tried` on batch probes. Batch support follows the rule above. A batch probe on a model without a batch provider (GLM,
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
