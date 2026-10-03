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
| `cron` | `KB_PIPELINE_CRON` | validated cron expression, America/Argentina/Buenos_Aires |
| `runTokenBudget` | `KB_RUN_TOKEN_BUDGET` | |
| `weeklyCostLimitUsd` | null | hard stop: a run is not submitted if its estimate exceeds this |
| `retryRejected` | `KB_RETRY_REJECTED` | |
| `subjectOverrides` | `{}` | `{ "<subjectId>": { modelWrite?, modelPlan?, paused?: bool } }` |

Endpoints:
- `GET /settings` → the effective settings, plus a `source` (env or db) for each field.
- `PUT /settings` with the body `{ …fields, note }`. It validates every model against the catalog (enabled, and the mode is
  supported). The response includes `costImpact`: the last 4 runs' recorded token usage re-priced with the new models,
  as `{ previousWeeklyAvgUsd, projectedWeeklyAvgUsd }`.
- `GET /settings/history`, and `POST /settings/history/{id}/restore`.
- Changes take effect at the next stage submission. A stage that is already running keeps the model it started with,
  and the model is recorded per batch or request.

## 2. Model catalog and prices

`wiki.kb_model` replaces the plain price table:
`id (DO model id), displayName, provider, batchSupported bool, toolCalling (unknown|yes|no), enabled bool, inputPerM, outputPerM,
cacheReadPerM, batchDiscount (0..1), contextWindow, notes, pricesUpdatedAt, lastProbe jsonb`.

- Seeded with the models listed in the pipeline doc. STAFF can edit prices or enable and disable models
  (`GET /models`, `PUT /models/{id}`, `POST /models` to add one).
- `POST /models/sync` reads DO's OpenAI-compatible `GET https://inference.do-ai.run/v1/models` (if available) and adds any
  missing ids as disabled entries with no price.
- `POST /models/{id}/probe` runs the probe from the pipeline doc and stores the result in `lastProbe`
  (mode, whether tool calling worked, latency, usage). A model can't be selected in the settings until a probe has succeeded.
- All costs are computed from recorded token usage multiplied by the catalog price **at the time of the run**, and stored
  on the run. Changing a price later doesn't rewrite history. `GET /costs?reprice=true` shows past runs at today's prices.

## 3. Cost analytics

- Every request result records `model, mode, stage, subjectId, inputTokens, cachedInputTokens, outputTokens, costUsd`
  in `wiki.kb_llm_usage` (one row per request; aggregate queries run over it).
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
- `POST /evals {setId, models: [{ plan, write }], note}` runs PLAN and WRITE as a full rebuild per subject, for each model
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
`GET /evals/leaderboard?setId` aggregates every eval of a set, per model configuration:
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
  `{ costImpact: { previousWeeklyAvgUsd, projectedWeeklyAvgUsd }, errors: [] }` and persists nothing.
- **Runs** live under `/pipeline/runs…` (pipeline doc). `POST /pipeline/runs/{id}/approve-cost`. The run detail adds
  `costUsd`, `costByStage: { DIGEST, PLAN, WRITE, RETRY }`, per-subject `costUsd`, and per-batch `costUsd`.
- **Benchmark sets:** `GET /evals/sets`, `POST /evals/sets { name, subjectIds }` (it freezes the inputs on creation), and
  `POST /evals/sets/{id}/refreeze`.
- **Evals:**
  - `GET /evals` and `GET /evals/{id}`. The detail is `{ id, setId, status, createdAt, configs: [{ configKey, plan, write, status, metrics, perSubject: [...] }] }`.
  - `POST /evals/estimate { setId, models }` returns `{ estimatedInputTokens, estimatedOutputTokens, estimatedCostUsd }`.
- **Blind review:**
  - `GET /evals/{id}/review/next?subjectId&slug` returns `{ subjectId, slug, remaining, a: Page, b: Page }`, where `Page` is
    `{ title, markdown, sources, links }`. It returns 204 when nothing is left to review.
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
  weekly: { expectedUsd, low, high, basis: "history"|"corpus"|"blend", runsUsed },
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
- `?settings=<json>` (or `POST /costs/forecast` with a settings body) computes the same forecast for **proposed** settings. It
  powers the settings dialog and the model picker. `POST /settings/preview` returns this forecast as `costImpact`
  `{ previous: forecast.weekly, projected: forecast.weekly }`.
- `GET /models/{id}/stage-cost?stage=` returns the expected weekly cost if this model were used for that stage, everything else
  unchanged. It's used to show a cost next to each option in the model picker.

### Actuals vs expected
- Each completed run stores `expectedCostUsd` (the forecast at submission) next to `costUsd` (actual).
- `GET /costs/summary` adds `accuracy: { lastRuns: [{ runId, expectedUsd, actualUsd }] }`, so admins can see how good the estimates are.

## 8. Reasoning effort and structured-output reliability (field shapes)

- **Settings:** `reasoningEffort: { digest?, plan?, write?, retry? }`, each `low|medium|high|null`. `null` means the model default.
  Defaults: `low` for GLM digest and plan, `medium` for write.
- **Eval model config:** `{ plan, write, reasoningEffort?: { plan?, write? } }`. The effort is part of `configKey`, e.g.
  `glm-5.3@low|glm-5.3@medium`.
- **Catalog item:** `supportsReasoningEffort: boolean` and `emptyToolCallRate: number|null`, computed over that model's last
  200 structured requests.
- **Eval metrics** add `emptyToolCallRate`.
- `GET /models/{id}/stage-cost?stage=` returns `{ stage, model, mode, expectedWeeklyUsd, low, high, basis }`.

## Implementation notes and deviations

- All paths are under `/v1/staff/kb` (STAFF only). Extra: `POST /evals/{id}/cancel`,
  `GET /evals/{id}/pages?configKey&subjectId&slug` (a page as the reviewer sees it).
- **Settings** keys for `reasoningEffort` and `maxTokens` are lowercase stages (`digest|plan|write|retry`).
  Validation only checks models that change (an unprobed env default doesn't block unrelated edits). `modelRetry`
  follows `modelWrite` unless set. History stores each saved version (newest first); restore saves it again as a new
  version.
- **costImpact** is a superset: `{previousWeeklyAvgUsd, projectedWeeklyAvgUsd, previous, projected}` where
  `previous`/`projected` are `forecast.weekly` objects for the current and the new settings.
- **Probe.** A batch probe on a model without a batch provider (GLM, DeepSeek...) is not attempted: `lastProbe` records
  `{ok:false, mode:"batch", error}` and `batchSupported` stays false. Batch probes complete on the poller
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
