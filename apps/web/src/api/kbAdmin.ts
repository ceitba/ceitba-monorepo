import { apiGet, apiSend } from './client'

// STAFF admin of the AI wiki pipeline: runtime settings, model catalog,
// costs, runs and model evaluations. Contract: CEITBA-API
// docs/SUBJECT-WIKI-ADMIN.md (+ docs/SUBJECT-WIKI-PIPELINE.md). Fields the
// doc doesn't pin down are optional and read defensively.

const enc = encodeURIComponent
const BASE = '/staff/kb'

export type Stage = 'DIGEST' | 'PLAN' | 'WRITE' | 'RETRY' | 'EVAL'
export const COST_STAGES: Stage[] = ['DIGEST', 'PLAN', 'WRITE', 'RETRY', 'EVAL']
export const MODEL_STAGES = ['digest', 'plan', 'write', 'retry'] as const
export type ModelStage = typeof MODEL_STAGES[number]
export type ExecutionMode = 'auto' | 'batch' | 'sync'

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
  cron: string
  runTokenBudget: number
  weeklyCostLimitUsd: number | null
  retryRejected: boolean
  subjectOverrides: Record<string, SubjectOverride>
  // Where each field's value comes from.
  source?: Partial<Record<keyof KbSettings, 'env' | 'db'>>
}

export interface CostImpact {
  previousWeeklyAvgUsd: number | null
  projectedWeeklyAvgUsd: number | null
}

export type SettingsBody = Omit<KbSettings, 'source'> & { note?: string }

export interface SettingsHistoryEntry {
  id: string
  settings: Partial<KbSettings>
  changedBy?: string | null
  changedByName?: string | null
  changedAt: string
  note?: string | null
}

export const fetchSettings = () => apiGet<KbSettings>(`${BASE}/settings`)

export function saveSettings(body: SettingsBody): Promise<KbSettings & { costImpact?: CostImpact }> {
  return apiSend('PUT', `${BASE}/settings`, body)
}

// Not in the contract yet: cost impact of a settings change without saving
// it. Callers treat a 404 as "only known after saving".
export function previewSettingsImpact(body: SettingsBody): Promise<{ costImpact?: CostImpact } & Partial<CostImpact>> {
  return apiSend('POST', `${BASE}/settings/preview`, body)
}

export const fetchSettingsHistory = () => apiGet<SettingsHistoryEntry[]>(`${BASE}/settings/history`)

export function restoreSettings(id: string): Promise<KbSettings> {
  return apiSend('POST', `${BASE}/settings/history/${enc(id)}/restore`)
}

// ── Model catalog ────────────────────────────────────────────────────────

export interface ModelProbe {
  ok?: boolean
  status?: string
  mode?: string
  toolCalling?: boolean | string
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
  toolCalling: 'unknown' | 'yes' | 'no'
  enabled: boolean
  inputPerM: number | null
  outputPerM: number | null
  cacheReadPerM: number | null
  batchDiscount: number | null
  contextWindow: number | null
  notes: string | null
  pricesUpdatedAt: string | null
  lastProbe: ModelProbe | null
}

export const fetchModels = () => apiGet<KbModel[]>(`${BASE}/models`)
export const updateModel = (id: string, body: Partial<KbModel>) => apiSend<KbModel>('PUT', `${BASE}/models/${enc(id)}`, body)
export const createModel = (body: Partial<KbModel> & { id: string }) => apiSend<KbModel>('POST', `${BASE}/models`, body)
export const syncModels = () => apiSend<KbModel[] | { added?: string[] }>('POST', `${BASE}/models/sync`)
export const probeModel = (id: string) => apiSend<KbModel | ModelProbe>('POST', `${BASE}/models/${enc(id)}/probe`)

// A model can be picked once a probe succeeded.
export function probeOk(m: KbModel | undefined | null): boolean {
  const p = m?.lastProbe
  if (!p) return false
  if (typeof p.ok === 'boolean') return p.ok
  return /^(ok|success|succeeded|completed)$/i.test(p.status ?? '')
}

// ── Costs ────────────────────────────────────────────────────────────────

export interface CostRow {
  key: string | Record<string, string>
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
}

export const fetchCostSummary = () => apiGet<CostSummary>(`${BASE}/costs/summary`)

export function fetchCosts(params: { from?: string; to?: string; groupBy: string; reprice?: boolean }): Promise<CostRow[]> {
  const qs = new URLSearchParams({ groupBy: params.groupBy })
  if (params.from) qs.set('from', params.from)
  if (params.to) qs.set('to', params.to)
  if (params.reprice) qs.set('reprice', 'true')
  return apiGet<CostRow[]>(`${BASE}/costs?${qs}`)
}

// Normalises a {key: number} map or a CostRow[] into [key, costUsd] pairs.
export function costPairs(v: CostRow[] | Record<string, number> | null | undefined): [string, number][] {
  if (!v) return []
  if (Array.isArray(v)) return v.map((r) => [typeof r.key === 'string' ? r.key : Object.values(r.key).join(' · '), r.costUsd ?? 0])
  return Object.entries(v).map(([k, n]) => [k, Number(n) || 0])
}

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
  costByStage?: Record<string, number> | CostRow[] | null
  error: string | null
  subjects: KbRunSubject[]
  batches: KbBatchJob[]
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
export const fetchPreview = () => apiGet<KbPreview>(`${BASE}/pipeline/preview`)

// ── Evaluations ──────────────────────────────────────────────────────────

export interface EvalSet {
  id: string
  name: string
  subjectIds: string[]
  createdBy?: string | null
  createdAt: string
}

export interface ModelConfig {
  plan: string
  write: string
}

export const configKey = (c: ModelConfig) => `${c.plan}+${c.write}`

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
  durationSec?: number | null
  rejectReasons?: Record<string, number> | null
}

export interface EvalConfigResult {
  configKey: string
  plan: string
  write: string
  status?: string
  metrics: EvalMetrics
  subjects?: ({ subjectId: string } & EvalMetrics)[]
}

export interface EvalRun {
  id: string
  setId: string
  setName?: string
  status: string
  note?: string | null
  createdAt: string
  finishedAt?: string | null
  configs: EvalConfigResult[]
}

export interface ReviewPage {
  label: 'A' | 'B'
  title: string
  summary?: string | null
  markdown: string
  sources?: { id: string; name: string; kind: string; author?: { name: string | null; anonymous: boolean } }[]
  links?: { raw: string; subjectId: string; slug: string | null; resolved: boolean; title: string | null; anchor?: string | null }[]
}

export interface ReviewPair {
  subjectId: string
  subjectName?: string | null
  slug: string
  a: ReviewPage
  b: ReviewPage
  remaining?: number
}

export interface ReviewResult {
  revealed?: { A?: ModelConfig & { configKey?: string }; B?: ModelConfig & { configKey?: string } }
}

export interface LeaderboardRow extends EvalMetrics {
  configKey: string
  plan: string
  write: string
  winRate: number | null
  ratings: number
  avgAccuracy: number | null
  avgClarity: number | null
  avgUsefulness: number | null
}

const EVALS = `${BASE}/evals`
export const fetchEvalSets = () => apiGet<EvalSet[]>(`${EVALS}/sets`)
export const createEvalSet = (body: { name: string; subjectIds: string[] }) => apiSend<EvalSet>('POST', `${EVALS}/sets`, body)
export const fetchEvals = () => apiGet<EvalRun[]>(EVALS)
export const fetchEval = (id: string) => apiGet<EvalRun>(`${EVALS}/${enc(id)}`)
export const createEval = (body: { setId: string; models: ModelConfig[]; note?: string }) => apiSend<EvalRun>('POST', EVALS, body)
// Not in the contract yet; a 404 means "no estimate available".
export const estimateEval = (body: { setId: string; models: ModelConfig[] }) =>
  apiSend<{ estimatedUsd?: number; perConfig?: Record<string, number>; estimatedTokens?: number }>('POST', `${EVALS}/estimate`, body)

export function fetchNextReview(evalId: string, opts: { subjectId?: string; slug?: string } = {}): Promise<ReviewPair | null> {
  const qs = new URLSearchParams()
  if (opts.subjectId) qs.set('subjectId', opts.subjectId)
  if (opts.slug) qs.set('slug', opts.slug)
  const q = qs.toString()
  // apiSend tolerates an empty 204 ("nothing left to review") → undefined.
  return apiSend<ReviewPair | null | undefined>('GET', `${EVALS}/${enc(evalId)}/review/next${q ? `?${q}` : ''}`).then((r) => r ?? null)
}

export function submitReview(evalId: string, body: {
  subjectId: string
  slug: string
  winner: 'A' | 'B' | 'tie'
  scores: { accuracy: number; clarity: number; usefulness: number }
  comment: string
}): Promise<ReviewResult | undefined> {
  return apiSend('POST', `${EVALS}/${enc(evalId)}/review`, body)
}

export const fetchLeaderboard = (setId: string) => apiGet<LeaderboardRow[]>(`${EVALS}/leaderboard?setId=${enc(setId)}`)
export const promoteEval = (id: string, key: string) => apiSend<KbSettings & { costImpact?: CostImpact }>('POST', `${EVALS}/${enc(id)}/promote`, { configKey: key })
