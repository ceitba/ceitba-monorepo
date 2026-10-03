import { apiGet, apiSend } from './client'

// STAFF admin of the AI wiki pipeline: runtime settings, model catalog,
// costs, runs and model evaluations. Contract: CEITBA-API
// docs/SUBJECT-WIKI-ADMIN.md (+ docs/SUBJECT-WIKI-PIPELINE.md). Fields the
// doc doesn't pin down are optional and read defensively.

const enc = encodeURIComponent
const BASE = '/staff/kb'

// PROBE: catalog probes, recorded in usage like any other request.
export type Stage = 'DIGEST' | 'PLAN' | 'WRITE' | 'RETRY' | 'EVAL' | 'PROBE'
export const COST_STAGES: Stage[] = ['DIGEST', 'PLAN', 'WRITE', 'RETRY', 'EVAL', 'PROBE']
export const MODEL_STAGES = ['digest', 'plan', 'write', 'retry'] as const
export type ModelStage = typeof MODEL_STAGES[number]
export type ExecutionMode = 'auto' | 'batch' | 'sync'
// Reasoning effort for reasoning models (e.g. GLM); null = model default.
export type ReasoningEffort = 'low' | 'medium' | 'high'
export const REASONING_EFFORTS: ReasoningEffort[] = ['low', 'medium', 'high']
export type StageReasoning = Partial<Record<ModelStage, ReasoningEffort | null>>

// ── Settings ─────────────────────────────────────────────────────────────

export interface SubjectOverride {
  modelWrite?: string | null
  modelPlan?: string | null
  paused?: boolean
}

export interface KbSettings {
  modelDigest: string
  modelPlan: string
  modelWrite: string
  modelRetry: string
  executionMode: ExecutionMode
  enabled: boolean
  // Spring cron, 6 fields with seconds: "0 0 3 * * SUN" (Buenos Aires).
  cron: string
  runTokenBudget: number
  weeklyCostLimitUsd: number | null
  retryRejected: boolean
  // Per stage; only meaningful for models with supportsReasoningEffort.
  reasoningEffort?: StageReasoning
  // Weekly refresh of DigitalOcean catalog prices. Absent on API builds
  // without it (the toggle is hidden then).
  autoRefreshPrices?: boolean
  // Output token cap per stage; not edited in the UI, passed through.
  maxTokens?: Partial<Record<ModelStage, number>>
  subjectOverrides: Record<string, SubjectOverride>
  // Where each field's value comes from.
  source?: Partial<Record<keyof KbSettings, 'env' | 'db'>>
}

// Normalised cost impact for the confirmation dialogs. Built from the
// forecast (ADMIN doc §7) or the older { previousWeeklyAvgUsd, ... }.
export interface CostImpact {
  previousWeeklyAvgUsd: number | null
  projectedWeeklyAvgUsd: number | null
  projectedRange?: { low: number | null; high: number | null } | null
  projectedMonthly?: { expectedUsd: number | null; low: number | null; high: number | null } | null
  fullRebuildUsd?: number | null
  basis?: ForecastBasis | null
  runsUsed?: number | null
}

export type ForecastBasis = 'history' | 'corpus' | 'blend'

export interface ForecastRange { expectedUsd: number | null; low: number | null; high: number | null }

export interface StageForecast {
  model: string | null
  mode: 'batch' | 'sync' | string | null
  inputTokens: number
  cachedInputTokens: number
  outputTokens: number
  costUsd: number
}

export interface CostForecast {
  settingsHash?: string
  nextRun: { dirtySubjects: number | string[]; perStage: Partial<Record<'DIGEST' | 'PLAN' | 'WRITE' | 'RETRY', StageForecast>>; totalUsd: number } | null
  weekly: ForecastRange & { basis: ForecastBasis; runsUsed: number }
  monthly: ForecastRange
  fullRebuild: { inputTokens: number; outputTokens: number; costUsd: number } | null
  savings: { batchUsd: number; cacheUsd: number } | null
  limits: { weeklyCostLimitUsd: number | null; exceedsLimit: boolean } | null
  discountIsEstimate: boolean
}

export const fetchForecast = () => apiGet<CostForecast>(`${BASE}/costs/forecast`)
// Forecast for proposed (unsaved) settings.
export const forecastFor = (settings: SettingsBody) => apiSend<CostForecast>('POST', `${BASE}/costs/forecast`, settings)

export function impactFrom(prev: CostForecast | null, next: CostForecast | null): CostImpact {
  return {
    previousWeeklyAvgUsd: prev?.weekly?.expectedUsd ?? null,
    projectedWeeklyAvgUsd: next?.weekly?.expectedUsd ?? null,
    projectedRange: next?.weekly ? { low: next.weekly.low, high: next.weekly.high } : null,
    projectedMonthly: next?.monthly ?? null,
    fullRebuildUsd: next?.fullRebuild?.costUsd ?? null,
    basis: next?.weekly?.basis ?? null,
    runsUsed: next?.weekly?.runsUsed ?? null,
  }
}

// costImpact as returned by PUT /settings or POST /settings/preview: either
// { previous: weekly, projected: weekly } (§7) or the older flat shape.
export function normalizeImpact(raw: unknown): CostImpact | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if ('previous' in r || 'projected' in r) {
    const p = r.previous as ForecastRange | undefined
    const q = r.projected as (ForecastRange & { basis?: ForecastBasis; runsUsed?: number }) | undefined
    return {
      previousWeeklyAvgUsd: p?.expectedUsd ?? null,
      projectedWeeklyAvgUsd: q?.expectedUsd ?? null,
      projectedRange: q ? { low: q.low ?? null, high: q.high ?? null } : null,
      basis: q?.basis ?? null,
      runsUsed: q?.runsUsed ?? null,
    }
  }
  return {
    previousWeeklyAvgUsd: (r.previousWeeklyAvgUsd as number) ?? null,
    projectedWeeklyAvgUsd: (r.projectedWeeklyAvgUsd as number) ?? null,
  }
}

export type SettingsBody = Omit<KbSettings, 'source'> & { note?: string }

export interface SettingsHistoryEntry {
  id: string
  settings: Partial<KbSettings>
  // User id (UUID); the API doesn't send a name.
  changedBy?: string | null
  changedByName?: string | null
  changedAt: string
  note?: string | null
}

// The API wraps settings as { settings, source, updatedAt, updatedBy, costImpact };
// the admin UI works on a flat KbSettings with `source` alongside.
type SettingsEnvelope = {
  settings?: KbSettings
  source?: KbSettings['source']
  costImpact?: unknown
}

function unwrapSettings(res: SettingsEnvelope | KbSettings): KbSettings & { costImpact?: unknown } {
  if (res && typeof res === 'object' && 'settings' in res && res.settings) {
    // autoRefreshPrices may sit next to `settings` in the envelope; keep it
    // on the flat object so it round-trips through PUT /settings.
    const top = (res as SettingsEnvelope & { autoRefreshPrices?: boolean }).autoRefreshPrices
    const flat = { ...res.settings, source: res.source, costImpact: res.costImpact }
    return top !== undefined && flat.autoRefreshPrices === undefined ? { ...flat, autoRefreshPrices: top } : flat
  }
  return res as KbSettings
}

export const fetchSettings = () => apiGet<SettingsEnvelope>(`${BASE}/settings`).then(unwrapSettings)

export function saveSettings(body: SettingsBody): Promise<KbSettings & { costImpact?: unknown }> {
  return apiSend<SettingsEnvelope>('PUT', `${BASE}/settings`, body).then(unwrapSettings)
}

// Not in the contract yet: cost impact of a settings change without saving
// it. Callers treat a 404 as "only known after saving".
export function previewSettingsImpact(body: SettingsBody): Promise<{ costImpact?: unknown; errors?: string[] }> {
  return apiSend('POST', `${BASE}/settings/preview`, body)
}

export const fetchSettingsHistory = () => apiGet<SettingsHistoryEntry[]>(`${BASE}/settings/history`)

export function restoreSettings(id: string): Promise<KbSettings> {
  return apiSend<SettingsEnvelope>('POST', `${BASE}/settings/history/${enc(id)}/restore`).then(unwrapSettings)
}

// ── Model catalog ────────────────────────────────────────────────────────

// ADMIN doc §6: { ok, mode: batch|sync, toolCalling: yes|no, latencyMs, usage, error?, at }.
export interface ModelProbe {
  ok: boolean
  status?: string
  mode?: 'batch' | 'sync' | string
  toolCalling?: 'yes' | 'no' | boolean | string
  latencyMs?: number
  usage?: { inputTokens?: number; outputTokens?: number } | null
  error?: string | null
  at?: string
}

export interface KbModel {
  id: string
  displayName: string | null
  provider: string | null
  batchSupported: boolean
  supportsReasoningEffort?: boolean
  // enabled + probed OK + usable in the current mode (API).
  selectable?: boolean
  // Effective prices (ADMIN doc §7): batch is null when the model can't
  // batch. batchSource tells whether support comes from the default rule
  // or a probe.
  effectivePrices?: { batch: Prices | null; sync: Prices } | null
  batchSource?: 'rule' | 'probe' | null
  batchVerifiedAt?: string | null
  batchDiscountVerified?: boolean
  // Share of requests whose structured (tool) output came back failed or
  // empty, over recorded usage.
  emptyToolCallRate?: number | null
  toolCalling: 'unknown' | 'yes' | 'no'
  enabled: boolean
  inputPerM: number | null
  outputPerM: number | null
  cacheReadPerM: number | null
  batchDiscount: number | null
  contextWindow: number | null
  notes: string | null
  pricesUpdatedAt: string | null
  // Where the prices come from: DigitalOcean's public catalog (synced) or
  // edited by hand by staff.
  priceSource?: 'do-catalog' | 'manual' | null
  lastProbe: ModelProbe | null
}

export interface PriceChange { field: string; old: number | string | null; new: number | string | null }

// POST /models/sync. Older API builds answered { added, available }.
export interface ModelSyncResult {
  updated?: { id: string; changes: PriceChange[] }[]
  added?: string[]
  unchanged?: number | string[]
  notInCatalog?: string[]
  source?: string | null
  fetchedAt?: string | null
  available?: number
}

export const fetchModels = () => apiGet<KbModel[]>(`${BASE}/models`)
export const updateModel = (id: string, body: Partial<KbModel>) => apiSend<KbModel>('PUT', `${BASE}/models/${enc(id)}`, body)
export const createModel = (body: Partial<KbModel> & { id: string }) => apiSend<KbModel>('POST', `${BASE}/models`, body)
export const syncModels = () => apiSend<ModelSyncResult>('POST', `${BASE}/models/sync`)
export const probeModel = (id: string) => apiSend<KbModel | ModelProbe>('POST', `${BASE}/models/${enc(id)}/probe`)

export interface Prices { inputPerM: number | null; outputPerM: number | null; cacheReadPerM: number | null }

// Expected weekly cost if `id` ran `stage` with everything else unchanged.
export async function fetchStageCost(id: string, stage: ModelStage): Promise<number | null> {
  const r = await apiGet<number | Record<string, number | null>>(`${BASE}/models/${enc(id)}/stage-cost?stage=${stage.toUpperCase()}`)
  if (typeof r === 'number') return r
  return r?.expectedWeeklyUsd ?? r?.weeklyUsd ?? r?.expectedUsd ?? r?.costUsd ?? null
}

// Whether a stage would run in batch for this model under `mode`.
export function runsBatch(m: KbModel | undefined | null, mode: ExecutionMode | undefined): boolean {
  if (!m?.batchSupported) return false
  return mode !== 'sync'
}

// Effective prices for a model under an execution mode: the batch prices
// when the stage would be batched, else the list (sync) prices.
export function effectivePrices(m: KbModel, mode: ExecutionMode | undefined): { prices: Prices; list: Prices; batched: boolean } {
  const list: Prices = m.effectivePrices?.sync ?? { inputPerM: m.inputPerM, outputPerM: m.outputPerM, cacheReadPerM: m.cacheReadPerM }
  if (!runsBatch(m, mode)) return { prices: list, list, batched: false }
  const d = m.batchDiscount ?? 0.5
  const cut = (v: number | null) => (v == null ? null : +(v * (1 - d)).toFixed(4))
  const fallback: Prices = { inputPerM: cut(list.inputPerM), outputPerM: cut(list.outputPerM), cacheReadPerM: cut(list.cacheReadPerM) }
  return { prices: m.effectivePrices?.batch ?? fallback, list, batched: true }
}

// Catalog order for tables and pickers: enabled first, then priced, then
// by name (the DO catalog adds dozens of disabled, unpriced models).
export function sortModels(list: KbModel[]): KbModel[] {
  const rank = (m: KbModel) => (m.enabled ? 0 : 2) + (m.inputPerM != null ? 0 : 1)
  return [...list].sort((a, b) => rank(a) - rank(b) || (a.displayName || a.id).localeCompare(b.displayName || b.id))
}

// Pickable in settings: the API's `selectable` (enabled + successfully
// probed + mode supported) when present, else derived locally.
export function isSelectable(m: KbModel, mode?: ExecutionMode): boolean {
  if (mode === 'batch' && !m.batchSupported) return false
  if (typeof m.selectable === 'boolean') return m.selectable
  return m.enabled && probeOk(m)
}

// A model can be picked once a probe succeeded.
export function probeOk(m: KbModel | undefined | null): boolean {
  const p = m?.lastProbe
  if (!p) return false
  if (typeof p.ok === 'boolean') return p.ok
  return /^(ok|success|succeeded|completed)$/i.test(p.status ?? '')
}

// ── Costs ────────────────────────────────────────────────────────────────

export interface CostRow {
  // Single-dimension groupings; multi-dimension rows (week,stage) carry
  // week + stage/model fields instead (ADMIN doc §6).
  key?: string | Record<string, string>
  // ISO date of the Monday (America/Argentina/Buenos_Aires).
  week?: string
  stage?: string
  model?: string
  subjectId?: string
  inputTokens: number
  cachedInputTokens: number
  outputTokens: number
  costUsd: number
  requests: number
}

export interface CostSummary {
  last7dUsd: number
  last30dUsd: number
  projectedMonthUsd: number
  cacheHitRatio: number | null
  byStage: CostRow[] | Record<string, number>
  byModel: CostRow[] | Record<string, number>
  topSubjects: (CostRow & { subjectName?: string })[]
  // Costs come from the fake LLM client (local/dev), not real billing.
  simulated?: boolean
  accuracy?: { lastRuns: { runId: string; expectedUsd: number | null; actualUsd: number | null; startedAt?: string | null }[] } | null
}

export const fetchCostSummary = () => apiGet<CostSummary>(`${BASE}/costs/summary`)

export function fetchCosts(params: { from?: string; to?: string; groupBy: string; reprice?: boolean }): Promise<CostRow[]> {
  const qs = new URLSearchParams({ groupBy: params.groupBy })
  if (params.from) qs.set('from', params.from)
  if (params.to) qs.set('to', params.to)
  if (params.reprice) qs.set('reprice', 'true')
  return apiGet<CostRow[]>(`${BASE}/costs?${qs}`)
}

export function rowKey(r: CostRow): string {
  if (typeof r.key === 'string') return r.key
  if (r.key) return Object.values(r.key).join(' · ')
  return r.subjectId ?? r.stage ?? r.model ?? r.week ?? ''
}

// Normalises a {key: number} map or a CostRow[] into [key, costUsd] pairs.
export function costPairs(v: CostRow[] | Record<string, number> | null | undefined): [string, number][] {
  if (!v) return []
  if (Array.isArray(v)) return v.map((r) => [rowKey(r), r.costUsd ?? 0])
  return Object.entries(v).map(([k, n]) => [k, Number(n) || 0])
}

// ── Live progress (runs and evals) ───────────────────────────────────────

export type StageStatus = 'pending' | 'running' | 'waiting_batch' | 'done' | 'failed' | 'skipped'

export interface StageProgress {
  stage: string
  status: StageStatus | string
  total: number | null
  done: number | null
  failed?: number | null
  inFlight?: number | null
  mode?: 'batch' | 'sync' | string | null
  batch?: { doStatus?: string | null; requestCounts?: { total?: number; completed?: number; failed?: number } | null } | null
  startedAt?: string | null
  finishedAt?: string | null
}

export interface Progress {
  stages: StageProgress[]
  overall?: { done: number; total: number; percent: number } | null
  // Human sentence in Spanish, e.g. "Redactando 12 de 40 páginas".
  current?: string | null
  etaSec?: number | null
  lastActivityAt?: string | null
  stalled?: boolean
}

// Per-subject eval status: pending | planning | writing | validating | done | failed.
export type SubjectEvalStatus = 'pending' | 'planning' | 'writing' | 'validating' | 'done' | 'failed' | string

// ── Runs (pipeline) ──────────────────────────────────────────────────────

export interface KbRunSubject {
  subjectId: string
  subjectName: string | null
  status: string
  model: string | null
  added: string[]
  changed: string[]
  removed: string[]
  operations: unknown
  accepted: unknown
  rejected: unknown
  deleted: unknown
  tokensIn: number
  tokensOut: number
  error: string | null
  costUsd?: number | null
}

export interface KbBatchJob {
  id: string
  stage: string
  attempt: number
  model: string | null
  status: string
  requestCount: number
  doBatchId: string | null
  tokensIn: number
  tokensOut: number
  submittedAt: string | null
  completedAt: string | null
  error: string | null
  costUsd?: number | null
}

export interface KbRun {
  id: string
  trigger: string
  status: string
  stage: string | null
  dryRun: boolean
  promptVersion: string | null
  model: string | null
  startedAt: string | null
  finishedAt: string | null
  estimatedTokens: number
  tokensIn: number
  tokensOut: number
  costEstimate: number | null
  costUsd?: number | null
  // Forecast at submission (ADMIN doc §7).
  expectedCostUsd?: number | null
  tokensCached?: number
  costApproved?: boolean
  simulated?: boolean
  // ADMIN doc §6: { DIGEST, PLAN, WRITE, RETRY }.
  costByStage?: Record<string, number> | null
  error: string | null
  subjects: KbRunSubject[]
  batches: KbBatchJob[]
  progress?: Progress | null
}

export interface KbPreview {
  dirty: {
    subjectId: string
    subjectName: string | null
    hasState: boolean
    added: { fileId: string; name: string; academicYear: number | null; chars: number; needsDigest: boolean }[]
    changed: { fileId: string; name: string; academicYear: number | null; chars: number; needsDigest: boolean }[]
    removed: string[]
    digestsNeeded: number
    estimatedTokens: number
  }[]
  cleanSubjects: number
  estimatedTokens: number
  tokenBudget: number
}

const RUNS = `${BASE}/pipeline/runs`
export const fetchRuns = (limit = 30) => apiGet<KbRun[]>(`${RUNS}?limit=${limit}`)
export const fetchRun = (id: string) => apiGet<KbRun>(`${RUNS}/${enc(id)}`)
export const startRun = (dryRun: boolean) => apiSend<KbRun>('POST', `${RUNS}${dryRun ? '?dryRun=true' : ''}`)
export const cancelRun = (id: string) => apiSend<KbRun>('POST', `${RUNS}/${enc(id)}/cancel`)
export const approveRunCost = (id: string) => apiSend<KbRun>('POST', `${RUNS}/${enc(id)}/approve-cost`)
export const fetchRunProgress = (id: string) => apiGet<Progress>(`${RUNS}/${enc(id)}/progress`)
export const fetchPreview = () => apiGet<KbPreview>(`${BASE}/pipeline/preview`)

// ── Evaluations ──────────────────────────────────────────────────────────

export interface EvalSet {
  id: string
  name: string
  subjectIds: string[]
  createdBy?: string | null
  createdAt: string
  // What the set froze (null until frozen).
  frozenAt?: string | null
  frozen?: { subjectId: string; subjectName: string; files: number; chars: number; digestsMissing: number }[] | null
}

export interface ModelConfig {
  plan: string
  write: string
  reasoningEffort?: { plan?: ReasoningEffort | null; write?: ReasoningEffort | null }
}

const withEffort = (model: string, effort?: ReasoningEffort | null) => (effort ? `${model}@${effort}` : model)
export const configKey = (c: ModelConfig) =>
  `${withEffort(c.plan, c.reasoningEffort?.plan)}+${withEffort(c.write, c.reasoningEffort?.write)}`

// "model" or "model (low)" for display.
export function modelWithEffort(model: string, effort?: ReasoningEffort | null): string {
  return effort ? `${model} (${effort})` : model
}

export interface EvalMetrics {
  firstPassValidRate?: number | null
  finalValidRate?: number | null
  citationDensity?: number | null
  uncitedSections?: number | null
  coverageViolations?: number | null
  copyViolations?: number | null
  unsupportedClaimsRate?: number | null
  pagesPlanned?: number | null
  pagesWritten?: number | null
  avgWords?: number | null
  crossLinks?: number | null
  anchors?: number | null
  inputTokens?: number | null
  outputTokens?: number | null
  costUsd?: number | null
  costPerValidPage?: number | null
  emptyToolCallRate?: number | null
  durationSec?: number | null
  rejectReasons?: Record<string, number> | null
}

export interface EvalConfigResult {
  configKey: string
  plan: string
  write: string
  reasoningEffort?: ModelConfig['reasoningEffort']
  status?: string
  metrics: EvalMetrics | null
  progress?: Progress | null
  perSubject?: {
    subjectId: string
    subjectName?: string | null
    status?: SubjectEvalStatus | null
    pagesPlanned?: number | null
    pagesWritten?: number | null
    pagesValid?: number | null
    metrics?: EvalMetrics | null
  }[]
}

export interface EvalRun {
  id: string
  setId: string
  setName?: string
  status: string
  note?: string | null
  createdAt: string
  finishedAt?: string | null
  stage?: string | null
  tokensIn?: number
  tokensOut?: number
  costUsd?: number | null
  durationSec?: number | null
  simulated?: boolean
  error?: string | null
  configs: EvalConfigResult[]
  progress?: Progress | null
  reviewSummary?: ReviewProgress | null
}

// RUNNING / WAITING / PENDING… are "still going"; anything else is final.
export const isActiveStatus = (s: string | null | undefined) =>
  /RUNNING|WAITING|PENDING|SUBMITTED|IN_PROGRESS|QUEUED|VALIDATING|BLOCKED/i.test(s ?? '')

export interface ReviewPage {
  label: 'A' | 'B'
  title: string
  summary?: string | null
  markdown: string
  sources?: { id: string; name: string; kind?: string; author?: { name: string | null; anonymous: boolean } }[]
  links?: { raw: string; subjectId: string; slug: string | null; resolved?: boolean; title?: string | null; anchor?: string | null }[]
}

export interface ReviewPair {
  subjectId: string
  subjectName?: string | null
  slug: string
  a: ReviewPage
  b: ReviewPage
  remaining?: number
  reviewedByMe?: number
  totalPairs?: number
}

// GET /evals/{id}/review/progress (also embedded as eval.reviewSummary).
export interface ReviewProgress {
  totalPairs: number
  reviewedByMe?: number
  reviewedByAnyone?: number
  remainingForMe?: number
  perSubject?: { subjectId: string; subjectName?: string | null; totalPairs: number; reviewedByMe?: number; reviewedByAnyone?: number }[]
  ratingsPerConfig?: { configKey: string; plan?: string; write?: string; ratings: number }[]
  minRatingsForConfidence?: number
  confident?: boolean
}

export interface ReviewResult {
  revealed?: { A?: ModelConfig & { configKey?: string }; B?: ModelConfig & { configKey?: string } }
}

// Normalised leaderboard row for the UI (built from the API entry below).
export interface LeaderboardRow extends EvalMetrics {
  configKey: string
  plan: string
  write: string
  reasoningEffort?: ModelConfig['reasoningEffort']
  winRate: number | null
  ratings: number
  avgAccuracy: number | null
  avgClarity: number | null
  avgUsefulness: number | null
  smallSample: boolean
  wins?: number
  losses?: number
  ties?: number
  evals?: number
}

// GET /evals/leaderboard → { setId, setName, entries: [...] } (API).
interface LeaderboardEntryApi {
  configKey: string
  plan: string
  write: string
  reasoningEffort?: ModelConfig['reasoningEffort'] | null
  evals?: number
  ratings?: number
  wins?: number
  losses?: number
  ties?: number
  winRate?: number | null
  avgScores?: { accuracy?: number | null; clarity?: number | null; usefulness?: number | null } | null
  metrics?: EvalMetrics | null
  costUsd?: number | null
  costPerValidPage?: number | null
  smallSample?: boolean
}

function toLeaderboardRow(e: LeaderboardEntryApi): LeaderboardRow {
  return {
    ...(e.metrics ?? {}),
    configKey: e.configKey,
    plan: e.plan,
    write: e.write,
    reasoningEffort: e.reasoningEffort ?? undefined,
    winRate: e.winRate ?? null,
    ratings: e.ratings ?? 0,
    avgAccuracy: e.avgScores?.accuracy ?? null,
    avgClarity: e.avgScores?.clarity ?? null,
    avgUsefulness: e.avgScores?.usefulness ?? null,
    costUsd: e.costUsd ?? e.metrics?.costUsd ?? null,
    costPerValidPage: e.costPerValidPage ?? e.metrics?.costPerValidPage ?? null,
    smallSample: e.smallSample ?? (e.ratings ?? 0) < 20,
    wins: e.wins,
    losses: e.losses,
    ties: e.ties,
    evals: e.evals,
  }
}

const EVALS = `${BASE}/evals`
export const fetchEvalSets = () => apiGet<EvalSet[]>(`${EVALS}/sets`)
export const createEvalSet = (body: { name: string; subjectIds: string[] }) => apiSend<EvalSet>('POST', `${EVALS}/sets`, body)
export const fetchEvals = () => apiGet<EvalRun[]>(EVALS)
export const fetchEval = (id: string) => apiGet<EvalRun>(`${EVALS}/${enc(id)}`)
export const fetchEvalProgress = (id: string) => apiGet<Progress>(`${EVALS}/${enc(id)}/progress`)
export const createEval = (body: { setId: string; models: ModelConfig[]; note?: string }) => apiSend<EvalRun>('POST', EVALS, body)
// Not in the contract yet; a 404 means "no estimate available".
export const estimateEval = (body: { setId: string; models: ModelConfig[] }) =>
  apiSend<{ estimatedInputTokens?: number; estimatedOutputTokens?: number; estimatedCostUsd?: number }>('POST', `${EVALS}/estimate`, body)
export const refreezeEvalSet = (id: string) => apiSend<EvalSet>('POST', `${EVALS}/sets/${enc(id)}/refreeze`)

export interface ReviewScores { accuracy: number; clarity: number; usefulness: number }

export function fetchNextReview(evalId: string, opts: { subjectId?: string; slug?: string } = {}): Promise<ReviewPair | null> {
  const qs = new URLSearchParams()
  if (opts.subjectId) qs.set('subjectId', opts.subjectId)
  if (opts.slug) qs.set('slug', opts.slug)
  const q = qs.toString()
  // apiSend tolerates an empty 204 ("nothing left to review") → undefined.
  return apiSend<ReviewPair | null | undefined>('GET', `${EVALS}/${enc(evalId)}/review/next${q ? `?${q}` : ''}`)
    .then((r) => (r ? { ...r, a: normalizeReviewPage(r.a, 'A'), b: normalizeReviewPage(r.b, 'B') } : null))
}

// The API's review pages carry sources as {id, name} and links as
// {raw, subjectId, slug, anchor}: fill what WikiMarkdown expects (a link
// with a slug resolves; sources default to kind OTHER, anonymous author).
function normalizeReviewPage(p: Partial<ReviewPage> | undefined, label: 'A' | 'B'): ReviewPage {
  return {
    label,
    title: p?.title ?? '',
    summary: p?.summary ?? null,
    markdown: p?.markdown ?? '',
    sources: (p?.sources ?? []).map((s) => ({ id: s.id, name: s.name, kind: s.kind ?? 'OTHER', author: s.author ?? { name: null, anonymous: true } })),
    links: (p?.links ?? []).map((l) => ({
      raw: l.raw,
      subjectId: l.subjectId,
      slug: l.slug ?? null,
      resolved: l.resolved ?? !!l.slug,
      title: l.title ?? null,
      anchor: l.anchor ?? null,
    })),
  }
}

export function submitReview(evalId: string, body: {
  subjectId: string
  slug: string
  winner: 'A' | 'B' | 'tie'
  // Per side, 1–5 each.
  scoresA: ReviewScores
  scoresB: ReviewScores
  comment: string
}): Promise<ReviewResult | undefined> {
  return apiSend('POST', `${EVALS}/${enc(evalId)}/review`, body)
}

export const fetchReviewProgress = (evalId: string) => apiGet<ReviewProgress>(`${EVALS}/${enc(evalId)}/review/progress`)

export async function fetchLeaderboard(setId: string): Promise<LeaderboardRow[]> {
  const r = await apiGet<{ entries?: LeaderboardEntryApi[] } | LeaderboardEntryApi[]>(`${EVALS}/leaderboard?setId=${enc(setId)}`)
  const entries = Array.isArray(r) ? r : r?.entries ?? []
  return entries.map(toLeaderboardRow)
}
export const promoteEval = (id: string, key: string) => apiSend<KbSettings & { costImpact?: unknown }>('POST', `${EVALS}/${enc(id)}/promote`, { configKey: key })
