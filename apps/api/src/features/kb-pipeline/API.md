# kb-pipeline: service API for the other kb agents

Owner: the kb-pipeline agent (`src/features/kb-pipeline/**`, `src/features/kb/logic/{pipeline,llm,progress,external}/**`,
`src/external/llm/**` except embeddings). Status: implemented; names are stable.

## Entry point

```ts
import { kbPipeline } from '../kb-pipeline/service';
const kb = kbPipeline(deps);          // one instance per Deps (WeakMap); the constructor does no I/O
```

| field | Java | main methods (async; DTOs are Jackson-shaped, see dto.ts) |
|---|---|---|
| `pipeline` | `KbPipelineService` | `trigger('MANUAL'\|'SCHEDULED', dryRun): KbRunResponse` (KbPipelineError 409 KB_RUN_ACTIVE / 503 KB_LLM_UNCONFIGURED), `runs(limit)`, `run(id)` (404 ResourceNotFound), `progress(id)`, `cancel(id)`, `approveCost(id)`, `baseline()`, `preview()`, `schedulerTick()` |
| `engine` | `KbRunEngine` | `register(handler: KbRunHandler)`, `request(run, subjectId, stage, target, chunk, model, params, seq)`, `triggered(runId)` / `kick(runId)` (= publishing `RunTriggered`: advances in the background only with `kb.pipeline.background`, like KbPipelineJob; a no-op in tests), `advance(runId)`, `advanceActive()`, `registerResume(id)`, `activeRunIds()`, `cancel(id)`, `approveCost(id)`, `forPages(ids, fn)`, `idle()` (await running advances, tests), `beginStop()` / `stop(waitMs?)` (shutdown: stop starting work, then wait and release the leases held) |
| `router` / `sync` / `batch` / `usage` / `payloads` / `submitter` | `KbLlmRouter` / `SyncLlmExecutor` / `BatchLlmExecutor` / `KbUsageRecorder` / `KbPayloads` / `KbBatchSubmitter` | the logic classes (`src/features/kb/logic/llm`, `.../pipeline`) wired with drizzle stores |
| `endpoints` | `KbEndpointRegistry` | the process registry the sync executor uses (in-flight/error counters) |
| `costs` | `KbCostService` | `costs(from, to, groupBy, reprice): KbCostRowResponse[]`, `summary()`, `spentSince(odt)`, `estimate(...)` |
| `quota` | `KbQuotaService` | `get(refresh): KbQuotaResponse` |
| `progress` | `KbProgressService` | `progress(runId): KbProgressResponse` (JSON form), `compute(runId)` (Odt form) |
| `retention` | `KbRunRetentionService` | `purgeExpired(): number` (KbRelationJob calls it nightly) |
| `inputs` | `KbInputs` (module) | `current()`, `diffs(paused, current?)`, `toJson`, `hash`, `subjectsWithPages()` |
| `quotaTracker` | `DoQuotaTracker` | the one fed by the DO clients (`deps.llm.quota`) |
| `models` | `KbModelRepository` reads | `DbKbModelStore` |
| `settings()` / `forecast()` | | the wired collaborators (kb-admin's `KbSettingsService` / `KbForecastService`) |

Types: `KbRunHandler`, `Seq`, `ACTIVE`, `MOVING`, `KbRun`, `KbRunSubject` are exported from `service.ts` too.
Transactions: `inTx(db, fn)` / `session()` from `db/session.ts` (a drizzle transaction plus a small persistence
context in AsyncLocalStorage; nested calls join it). Engine handlers (`detect/build/after/redo`) run inside the
engine's transaction with the run row locked: anything they read/write must join it (kb-admin's `kbTx` does).

Jobs: `jobs.ts` registers KbPipelineJob (JobLock 10 pollBatches, 11 sweep, 12 tick, plus a one-shot onStartup).

## What the pipeline needs from the other agents

`kbCollaborators(deps)` (service.ts, the composition root) wires them from kb-admin (`kbAdmin(deps)`) and kb-reader
(`kbReader(deps)`) on first use, so they never depend on route registration order. A test can register a fake first
with `provideKbCollaborators(deps, {...})` (any subset); what is registered first wins:

| key | owner | used for |
|---|---|---|
| `settings` | kb-admin `KbSettingsService` | `effective()`, `maxRequestsPerStage()`, `digestMaxMissingRatio()`, `batchMaxRequests()` (fallback: `settings.ts`, same merge) |
| `forecast` | kb-admin `KbForecastService` | `nextRunTotal(s)`, `subjectEstimates(s, dirty)` (required: DETECT fails without it) |
| `importer` | kb-reader `KbImportService` | `validate(subjectId, pages, removing, tx)`, `importSubject(subjectId, {pages, replace}, tx)`. **Please forward `tx`** (the pipeline's drizzle transaction, flushed) to your `db` argument so PUBLISH is one transaction like Java's. No fallback: without it PUBLISH fails the subject. |
| `catalog` | kb-admin `KbModelCatalogService` | `sync('do-catalog')` before a scheduled run, `refreshPendingProbes()` from the batch poller |
| `evals` | kb-admin `KbEvalService` | `ensureDefaultSet()` at startup |
