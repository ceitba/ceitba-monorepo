// Response records of the pipeline (web/kb/dto/KbRun*, KbBatchJobResponse, KbProgressResponse,
// KbPreviewResponse, KbBaselineResponse; web/kb/admin/KbCost*, KbQuotaResponse), in record
// component order, with values already in their Jackson form:
//   OffsetDateTime -> string (ISO_OFFSET_DATE_TIME: seconds always, fraction stripped)
//   BigDecimal     -> Dec (serializes as BigDecimal.toString())
//   double         -> JSON.rawJSON (Double.toString)
//   JsonNode       -> JsonValue (Dec / JDouble inside serialize like Jackson)

import { javaDouble } from '../../lib/json';
import type { Dec } from '../kb/logic/decimal';
import type { JsonValue } from '../kb/logic/jsonNode';
import { offsetId, type Odt } from '../kb/logic/odt';
import type { KbProgressResponse as ProgressMath } from '../kb/logic/progress/kbProgressMath';

type Raw = ReturnType<typeof JSON.rawJSON>;
const pad = (n: number, w = 2): string => String(n).padStart(w, '0');

/** Jackson's OffsetDateTimeSerializer (ISO_OFFSET_DATE_TIME) of an Odt, at its own offset. */
export function odtJson(o: Odt | null | undefined): string | null {
  if (o == null) return null;
  const l = o.local();
  const y = l.year < 0 ? `-${pad(-l.year, 4)}` : l.year > 9999 ? `+${l.year}` : pad(l.year, 4);
  let frac = '';
  if (o.nano > 0) frac = '.' + String(o.nano).padStart(9, '0').replace(/0+$/, '');
  return `${y}-${pad(l.month)}-${pad(l.day)}T${pad(l.hour)}:${pad(l.minute)}:${pad(l.second)}${frac}${offsetId(o.offsetSeconds)}`;
}

/** web/kb/dto/KbRunBudgetResponse. */
export interface KbRunBudgetResponse {
  limitUsd: Dec;
  estimatedUsd: Dec;
  spentUsd: Dec;
  admitted: number;
  deferred: number;
  deferredEstimatedUsd: Dec;
  tokenBudget: number;
  oversizedSubjectId: string | null;
}

/** web/kb/dto/KbRunSubjectResponse. */
export interface KbRunSubjectResponse {
  subjectId: string;
  subjectName: string | null;
  status: string;
  model: string;
  added: string[];
  changed: string[];
  removed: string[];
  operations: JsonValue;
  accepted: JsonValue;
  rejected: JsonValue;
  deleted: JsonValue;
  tokensIn: number;
  tokensOut: number;
  tokensCached: number;
  costEstimate: Dec;
  costUsd: Dec;
  error: string | null;
  droppedPlanOps: JsonValue | null;
  skippedFiles: number;
}

/** web/kb/dto/KbBatchJobResponse. */
export interface KbBatchJobResponse {
  id: string;
  stage: string;
  attempt: number;
  model: string;
  mode: string;
  status: string;
  requestCount: number;
  doBatchId: string | null;
  payloadKey: string | null;
  outputKey: string | null;
  tokensIn: number;
  tokensOut: number;
  tokensCached: number;
  costEstimate: Dec | null;
  costUsd: Dec;
  submittedAt: string | null;
  completedAt: string | null;
  error: string | null;
  nextAttemptAt: string | null;
}

/** web/kb/dto/KbProgressResponse (JSON form). */
export interface KbProgressResponse {
  stages: {
    stage: string;
    status: string;
    total: number | null;
    done: number;
    failed: number;
    inFlight: number;
    mode: string | null;
    batch: {
      doStatus: string | null;
      requestCounts: { total: number; completed: number; failed: number } | null;
      submittedAt: string | null;
      status: string;
      error: string | null;
      nextAttemptAt: string | null;
    } | null;
    startedAt: string | null;
    finishedAt: string | null;
  }[];
  overall: { done: number; total: number; percent: Raw };
  current: string;
  etaSec: number | null;
  lastActivityAt: string | null;
  stalled: boolean;
}

export function progressJson(p: ProgressMath): KbProgressResponse {
  return {
    stages: p.stages.map((s) => ({
      stage: s.stage,
      status: s.status,
      total: s.total,
      done: s.done,
      failed: s.failed,
      inFlight: s.inFlight,
      mode: s.mode,
      batch: s.batch == null ? null : {
        doStatus: s.batch.doStatus,
        requestCounts: s.batch.requestCounts == null ? null
          : { total: s.batch.requestCounts.total, completed: s.batch.requestCounts.completed, failed: s.batch.requestCounts.failed },
        submittedAt: odtJson(s.batch.submittedAt),
        status: s.batch.status,
        error: s.batch.error,
        nextAttemptAt: odtJson(s.batch.nextAttemptAt),
      },
      startedAt: odtJson(s.startedAt),
      finishedAt: odtJson(s.finishedAt),
    })),
    overall: { done: p.overall.done, total: p.overall.total, percent: javaDouble(p.overall.percent)! },
    current: p.current,
    etaSec: p.etaSec,
    lastActivityAt: odtJson(p.lastActivityAt),
    stalled: p.stalled,
  };
}

/** web/kb/dto/KbRunResponse; subjects/batches/progress/costByStage only on GET .../runs/{id}. */
export interface KbRunResponse {
  id: string;
  trigger: string;
  status: string;
  stage: string | null;
  dryRun: boolean;
  promptVersion: string | null;
  model: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  estimatedTokens: number;
  tokensIn: number;
  tokensOut: number;
  tokensCached: number;
  costEstimate: Dec | null;
  costUsd: Dec;
  expectedCostUsd: Dec | null;
  costByStage: Record<string, Dec> | null;
  costApproved: boolean;
  simulated: boolean;
  error: string | null;
  subjects: KbRunSubjectResponse[] | null;
  batches: KbBatchJobResponse[] | null;
  progress: KbProgressResponse | null;
  budget: KbRunBudgetResponse | null;
}

/** web/kb/dto/KbBaselineResponse. */
export interface KbBaselineResponse {
  subjects: string[];
}

/** web/kb/dto/KbPreviewResponse. */
export interface KbPreviewFile {
  fileId: string;
  name: string;
  academicYear: number | null;
  chars: number;
  needsDigest: boolean;
}

export interface KbPreviewSubject {
  subjectId: string;
  subjectName: string | null;
  hasState: boolean;
  added: KbPreviewFile[];
  changed: KbPreviewFile[];
  removed: string[];
  digestsNeeded: number;
  estimatedTokens: number;
}

export interface KbPreviewResponse {
  dirty: KbPreviewSubject[];
  cleanSubjects: number;
  estimatedTokens: number;
  tokenBudget: number;
}

/** web/kb/admin/KbCostRowResponse (@JsonInclude NON_NULL: absent dimensions are omitted). */
export interface KbCostRowResponse {
  key: string;
  week?: string;
  stage?: string;
  model?: string;
  subjectId?: string;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  costUsd: Dec;
  requests: number;
}

/** web/kb/admin/KbCostSummaryResponse. */
export interface KbCostSummaryResponse {
  last7dUsd: Dec;
  last30dUsd: Dec;
  projectedMonthUsd: Dec;
  byStage: Record<string, Dec>;
  byModel: Record<string, Dec>;
  topSubjects: { subjectId: string; subjectName: string | null; costUsd: Dec }[];
  cacheHitRatio: Raw;
  simulated: boolean;
  accuracy: { lastRuns: { runId: string; startedAt: string | null; trigger: string; expectedUsd: Dec; actualUsd: Dec }[] };
}

/** web/kb/admin/KbQuotaResponse. */
export interface KbQuotaCounter {
  limit: number | null;
  remaining: number | null;
}

export interface KbQuotaResponse {
  observedAt: string | null;
  batch: {
    creationsPerHour: KbQuotaCounter | null;
    createPerMinute: KbQuotaCounter | null;
    requestsPerDay: KbQuotaCounter | null;
    statusChecksPerMinute: KbQuotaCounter | null;
  };
  sync: { tokensPerDay: KbQuotaCounter | null; tokensPerMinute: KbQuotaCounter | null; requestsPerMinute: KbQuotaCounter | null };
  stale: boolean;
}
