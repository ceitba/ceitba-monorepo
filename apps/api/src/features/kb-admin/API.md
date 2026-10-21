# kb-admin: service API for the other kb agents

Owner: the kb-admin agent (`src/features/kb-admin/**`, `src/features/kb/logic/{admin,eval,web}/**`). Status: DRAFT;
names are stable, signatures may gain optional arguments.

## Entry point

```ts
import { kbAdmin } from '../kb-admin/service';
const admin = kbAdmin(deps);   // one instance per Deps (WeakMap); constructors do no I/O
```

| field | Java | methods (async) |
|---|---|---|
| `settings` | `KbSettingsService` | `effective(): KbEffectiveSettings` (logic/admin/kbSettings.ts class), `get()`, `update(userId, body)`, `preview(body)`, `proposed(body)`, `history(limit)`, `restore(userId, id)`, `maxRequestsPerStage()`, `digestMaxMissingRatio()`, `batchMaxRequests()` |
| `forecast` | `KbForecastService` | `forecast(s)`, `stageCost(s, model, stage)`, `nextRunTotal(s): Dec`, `subjectEstimates(s, dirty): Map<subjectId, {subjectId, costUsd: Dec, inputTokens}>` |
| `catalog` | `KbModelCatalogService` | `list()`, `create(body)`, `update(id, body)`, `sync(historySource = 'do-catalog')`, `probe(id, mode)`, `refreshPendingProbes()` |
| `endpoints` | `KbEndpointService` | `list()`, `create(userId, body)`, `update(userId, id, body)`, `delete(id)`, `test(id)`, `discover(id)`, `stats(id, minutes)` |
| `evals` | `KbEvalService` | the StaffKbEvalController operations; also the engine's `KbRunHandler` for `trigger = 'EVAL'` runs |

`kbAdmin(deps)` registers `settings`, `forecast` and `catalog` with `provideKbCollaborators` (kb-pipeline/API.md) and
`evals` as the engine's `KbRunHandler` for `trigger = 'EVAL'` runs (`kbPipeline(deps).engine.register`) when it is first
built (routes.ts builds it at boot), so the pipeline never runs on its fallbacks in the app. `jobs.ts` runs
`evals.ensureDefaultSet()` at startup (Java: `KbPipelineJob.onStartup`, no JobLock).

All services run in kb-pipeline's `inTx` (via `./tx.ts` `kbTx`), so a call made inside an engine transaction joins it.

`body` arguments are Jackson trees (`logic/jsonNode.ts` values, parsed with `readJacksonTree`), as Java's
`@RequestBody JsonNode`.

## What kb-admin uses from kb-pipeline

`kbPipeline(deps)`: `pipeline.*` (StaffKbPipelineController routes are registered by kb-admin and call it),
`costs` / `quota` (StaffKbAdminController `/costs`, `/costs/summary`, `/quota`), `inputs.current()/diffs()`,
`router`, `sync`, `batch`, `usage`, `payloads`, `endpoints` (registry: in-flight/error counters for `/stats`),
`engine` (`register(handler)`, `request(...)`, `cancel`, `kick`), `progress`.
