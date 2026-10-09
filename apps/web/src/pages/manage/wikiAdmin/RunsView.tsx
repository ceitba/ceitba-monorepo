import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import {
  approveRunCost, cancelRun, isActiveStatus, isBlockedStatus, fetchRunProgress, costPairs, fetchPreview, fetchRun, fetchRuns, startRun, type KbRun, type KbRunBudget, type KbRunSubject,
} from '../../../api/kbAdmin'
import { ApiError } from '../../../api/client'
import { Alert, Badge, Button, ConfirmDialog, EmptyState, Modal, toast } from '@/components/ui'
import { apuntesAdminErrorMessage } from '../adminErrors'
import ProgressPanel, { ProgressBar } from './ProgressPanel'
import { RUN_STAGES } from './stages'
import { useLiveProgress } from './useLiveProgress'
import NotifyButton from './NotifyButton'
import { markActive } from './jobWatchStore'
import { Panel, StatusPill, ViewState } from './shared'
import { statusLabel } from './status'
import { duration, tokens, usd } from './format'
import { TD, TH } from './styles'
import { useLoad } from './useLoad'
import { useQueueOptional } from '../review/queueContext'

const PIPELINE: string[] = ['DETECT', 'DIGEST', 'PLAN', 'WRITE', 'RETRY', 'LINK', 'VALIDATE', 'PUBLISH']

// Ejecuciones: list + detail, run now / simulation / preview, cancel,
// approve cost for BLOCKED_BY_COST_LIMIT runs. A real run spends money, so
// it asks first; a simulation costs nothing and starts right away.
export default function RunsView({ openId, onOpen }: { openId: string | null; onOpen: (id: string | null) => void }) {
  const queue = useQueueOptional()
  const { t, i18n } = useTranslation()
  const runs = useLoad(() => fetchRuns(30))
  // Keep RUNNING rows moving: refresh the list every 10 s while any run is
  // active and the browser tab is visible.
  const anyActive = (runs.data ?? []).some((r) => isActiveStatus(r.status))
  useEffect(() => {
    (runs.data ?? []).forEach((r) => { if (isActiveStatus(r.status)) markActive('run', r.id, r.startedAt ?? r.id) })
  }, [runs.data])
  // reload is a stable callback, so polling restarts only when anyActive flips.
  const { reload: reloadRuns } = runs
  useEffect(() => {
    if (!anyActive) return
    const id = window.setInterval(() => { if (document.visibilityState === 'visible') reloadRuns() }, 10000)
    return () => window.clearInterval(id)
  }, [anyActive, reloadRuns])
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirmRun, setConfirmRun] = useState(false)
  const [preview, setPreview] = useState(false)

  async function start(dry: boolean) {
    setError(null); setBusy(dry ? 'dry' : 'start')
    try {
      const run = await startRun(dry)
      queue?.reloadSource('wiki')
      toast.success(dry ? t('manage.wikiAi.runs.dryStarted') : t('manage.wikiAi.runs.started'))
      setConfirmRun(false)
      runs.reload()
      if (run?.id) onOpen(run.id)
    } catch (e) {
      // Only KB_RUN_ACTIVE means another run; other 409s (e.g. a data error) get their own message.
      setError(e instanceof ApiError && e.code === 'KB_RUN_ACTIVE' ? t('manage.wikiAi.runs.alreadyActive') : apuntesAdminErrorMessage(e, t))
    } finally {
      setBusy(null)
    }
  }

  if (openId) return <RunDetail id={openId} onBack={() => { onOpen(null); runs.reload() }} />

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" disabled={!!busy} onClick={() => { setError(null); setConfirmRun(true) }}>{t('manage.wikiAi.runs.runNow')}</Button>
        <Button size="sm" variant="outline" disabled={!!busy} loading={busy === 'dry'} onClick={() => void start(true)}>{t('manage.wikiAi.runs.dryRun')}</Button>
        <Button size="sm" variant="outline" onClick={() => setPreview(true)}>{t('manage.wikiAi.runs.preview')}</Button>
        <Button size="sm" variant="ghost" className="ml-auto" onClick={runs.reload}>{t('manage.wikiAi.refresh')}</Button>
      </div>
      <p className="font-body text-label text-ink-secondary dark:text-night-muted">{t('manage.wikiAi.runs.dryBody')}</p>
      {error && !confirmRun && <Alert tone="error" onDismiss={() => setError(null)}>{error}</Alert>}
      <ViewState state={runs} skeleton="rows" empty={(r) => r.length === 0} emptyText={t('manage.wikiAi.runs.empty')}>
        {(list) => (
          <div className="overflow-x-auto rounded-card border border-border dark:border-night-border">
            <table className="w-full font-body text-body-sm">
              <thead className="bg-page-bg dark:bg-night-bg"><tr>
                <th className={TH}>{t('manage.wikiAi.runs.started_')}</th>
                <th className={TH}>{t('manage.wikiAi.runs.status')}</th>
                <th className={TH}>{t('manage.wikiAi.runs.trigger')}</th>
                <th className={`${TH} text-right`}>{t('manage.wikiAi.runs.subjects')}</th>
                <th className={`${TH} text-right`}>{t('manage.wikiAi.runs.tokens')}</th>
                <th className={`${TH} text-right`}>{t('manage.wikiAi.runs.cost')}</th>
                <th className={`${TH} text-right`}>{t('manage.wikiAi.runs.duration')}</th>
              </tr></thead>
              <tbody>
                {list.map((r) => (
                  <tr key={r.id} className="border-t border-border dark:border-night-border hover:bg-primary-50 dark:hover:bg-primary-900/30 cursor-pointer" onClick={() => onOpen(r.id)}>
                    <td className={TD}>
                      <button type="button" className="text-left hover:text-primary" onClick={(e) => { e.stopPropagation(); onOpen(r.id) }}>
                        {r.startedAt ? new Date(r.startedAt).toLocaleString(i18n.language) : '—'}
                      </button>
                    </td>
                    <td className={TD}>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <StatusPill status={r.status} />
                        {r.stage && <span className="font-mono text-label text-ink-secondary dark:text-night-muted">{stageLabel(r.stage, t)}</span>}
                        {r.dryRun && <Badge>{t('manage.wikiAi.runs.dry')}</Badge>}
                        {r.simulated && <Badge tone="warning">{t('manage.wikiAi.simulatedShort')}</Badge>}
                      </div>
                      {isActiveStatus(r.status) && (
                        <ProgressBar className="mt-1.5 w-40" percent={r.progress?.overall?.percent} indeterminate={!r.progress?.overall} />
                      )}
                    </td>
                    <td className={TD}>{triggerLabel(r.trigger, t)}</td>
                    <td className={`${TD} text-right tabular-nums`}>{r.subjects?.length ?? 0}</td>
                    <td className={`${TD} text-right tabular-nums`}>{tokens((r.tokensIn ?? 0) + (r.tokensOut ?? 0))}</td>
                    <td className={`${TD} text-right tabular-nums`}>
                      {usd(r.costUsd ?? r.costEstimate, 2)}
                      {r.expectedCostUsd != null && (
                        <span className="block font-mono text-label text-ink-secondary dark:text-night-muted">{t('manage.wikiAi.forecast.expectedShort', { cost: usd(r.expectedCostUsd, 2) })}</span>
                      )}
                    </td>
                    <td className={`${TD} text-right tabular-nums`}>{duration(r.startedAt, r.finishedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </ViewState>

      {confirmRun && (
        <ConfirmDialog
          title={t('manage.wikiAi.runs.runTitle')}
          body={t('manage.wikiAi.runs.runBody')}
          confirmLabel={t('manage.wikiAi.runs.runConfirm')}
          danger={false}
          busy={busy === 'start'}
          error={error}
          onConfirm={() => void start(false)}
          onCancel={() => { setConfirmRun(false); setError(null) }}
        />
      )}
      {preview && <PreviewDialog onClose={() => setPreview(false)} />}
    </div>
  )
}

function PreviewDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation()
  const p = useLoad(fetchPreview)
  return (
    <Modal title={t('manage.wikiAi.runs.preview')} onClose={onClose} size="2xl" footer={<Button onClick={onClose}>{t('manage.wikiAi.close')}</Button>}>
      <ViewState state={p} skeleton="rows">
        {(d) => (
          <div className="flex flex-col gap-3 font-body text-body-sm">
            <p className="text-ink-secondary dark:text-night-muted">
              {t('manage.wikiAi.runs.previewSummary', { dirty: d.dirty.length, clean: d.cleanSubjects, tokens: tokens(d.estimatedTokens), budget: tokens(d.tokenBudget) })}
            </p>
            {d.estimatedTokens > d.tokenBudget && <p className="text-amber-700 dark:text-amber-300">{t('manage.wikiAi.runs.overBudget')}</p>}
            {d.dirty.length === 0 ? (
              <EmptyState compact title={t('manage.wikiAi.runs.nothingToDo')} />
            ) : (
              <ul className="flex flex-col divide-y divide-border dark:divide-night-border max-h-[50vh] overflow-y-auto">
                {d.dirty.map((s) => (
                  <li key={s.subjectId} className="py-2">
                    <p className="font-semibold"><span className="font-mono text-label mr-1.5">{s.subjectId}</span>{s.subjectName}</p>
                    <p className="text-ink-secondary dark:text-night-muted">
                      {t('manage.wikiAi.runs.diff', { added: s.added.length, changed: s.changed.length, removed: s.removed.length, digests: s.digestsNeeded, tokens: tokens(s.estimatedTokens) })}
                    </p>
                    {[...s.added, ...s.changed].length > 0 && (
                      <p className="font-mono text-label text-ink-secondary dark:text-night-muted truncate">{[...s.added, ...s.changed].map((f) => f.name).join(' · ')}</p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </ViewState>
    </Modal>
  )
}

// Cost budget of the run (limit, spend, admitted vs deferred subjects).
function RunBudget({ budget: b, subjects }: { budget: KbRunBudget; subjects: KbRunSubject[] }) {
  const { t } = useTranslation()
  const oversized = b.oversizedSubjectId
    ? subjects?.find((s) => s.subjectId === b.oversizedSubjectId)?.subjectName || b.oversizedSubjectId
    : null
  return (
    <div className="mb-3 font-body text-body-sm" aria-label={t('manage.wikiAi.runs.budget.title')}>
      <p>
        {t('manage.wikiAi.runs.budget.summary', {
          spent: usd(b.spentUsd, 2), limit: usd(b.limitUsd, 2), estimated: usd(b.estimatedUsd, 2),
          admitted: b.admitted ?? 0, deferred: b.deferred ?? 0, deferredEstimated: usd(b.deferredEstimatedUsd, 2),
        })}
      </p>
      {oversized && <p className="text-amber-700 dark:text-amber-300">{t('manage.wikiAi.runs.budget.oversized', { subject: oversized })}</p>}
    </div>
  )
}

function asList(v: unknown): { slug?: string; errors?: string[]; title?: string }[] {
  if (Array.isArray(v)) return v.map((x) => (typeof x === 'string' ? { slug: x } : (x as { slug?: string; errors?: string[] })))
  return []
}

function RunDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const queue = useQueueOptional()
  const { t, i18n } = useTranslation()
  const run = useLoad(() => fetchRun(id), [id])
  const live = useLiveProgress({ active: isActiveStatus(run.data?.status ?? ''), fetchProgress: () => fetchRunProgress(id), refreshDetail: run.reload })
  const progress = live.progress ?? run.data?.progress ?? null
  useEffect(() => { if (run.data && isActiveStatus(run.data.status)) markActive('run', id, run.data.startedAt ?? id) }, [run.data, id])
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirmCancel, setConfirmCancel] = useState(false)

  async function act(kind: 'cancel' | 'approve') {
    setError(null); setBusy(kind)
    try {
      const r = kind === 'cancel' ? await cancelRun(id) : await approveRunCost(id)
      queue?.reloadSource('wiki')
      if (r?.id) run.setData(() => r)
      else run.reload()
      setConfirmCancel(false)
    } catch (e) {
      setError(apuntesAdminErrorMessage(e, t))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Button variant="ghost" size="sm" className="self-start" onClick={onBack}>← {t('manage.wikiAi.runs.back')}</Button>
      {error && !confirmCancel && <Alert tone="error" onDismiss={() => setError(null)}>{error}</Alert>}
      <ViewState state={run}>
        {(r: KbRun) => {
          const stageCost = costPairs(r.costByStage ?? null)
          const batchCost = new Map<string, number>()
          r.batches?.forEach((b) => { if (b.costUsd != null) batchCost.set(b.stage, (batchCost.get(b.stage) ?? 0) + b.costUsd) })
          const costOf = (st: string) => stageCost.find(([k]) => k.toUpperCase() === st)?.[1] ?? batchCost.get(st)
          const currentIdx = r.stage ? PIPELINE.indexOf(r.stage.toUpperCase()) : -1
          const finished = !isActiveStatus(r.status)
          return (
            <>
              <Panel
                title={<span className="flex flex-wrap items-center gap-2">{t('manage.wikiAi.runs.run')} <StatusPill status={r.status} />{r.dryRun && <Badge>{t('manage.wikiAi.runs.dry')}</Badge>}</span>}
                actions={
                  <div className="flex flex-wrap gap-2">
                    {/BLOCKED_BY_COST_LIMIT/i.test(r.status) && (
                      <Button size="sm" onClick={() => act('approve')} disabled={!!busy} loading={busy === 'approve'}>{t('manage.wikiAi.runs.approveCost')}</Button>
                    )}
                    {!finished && <NotifyButton kind="run" id={id} />}
                    {(!finished || isBlockedStatus(r.status)) && <Button size="sm" variant="dangerGhost" onClick={() => { setError(null); setConfirmCancel(true) }} disabled={!!busy}>{t('manage.wikiAi.runs.cancel')}</Button>}
                    <Button size="sm" variant="outline" onClick={run.reload}>{t('manage.wikiAi.refresh')}</Button>
                  </div>
                }
              >
                <dl className="grid grid-cols-2 md:grid-cols-4 gap-3 font-body text-body-sm mb-4">
                  <Info label={t('manage.wikiAi.runs.trigger')} value={triggerLabel(r.trigger, t)} />
                  <Info label={t('manage.wikiAi.runs.started_')} value={r.startedAt ? new Date(r.startedAt).toLocaleString(i18n.language) : '—'} />
                  <Info label={t('manage.wikiAi.runs.duration')} value={duration(r.startedAt, r.finishedAt)} />
                  <Info label={t('manage.wikiAi.runs.cost')} value={usd(r.costUsd ?? r.costEstimate, 2)} />
                  <Info label={t('manage.wikiAi.forecast.expected')} value={usd(r.expectedCostUsd ?? r.costEstimate, 2)} />
                  <Info label={t('manage.wikiAi.runs.tokensIn')} value={tokens(r.tokensIn)} />
                  <Info label={t('manage.wikiAi.runs.tokensOut')} value={tokens(r.tokensOut)} />
                  <Info label={t('manage.wikiAi.runs.estimated')} value={tokens(r.estimatedTokens)} />
                  <Info label={t('manage.wikiAi.runs.prompt')} value={r.promptVersion ?? '—'} />
                </dl>
                {r.error && <p className="mb-3 font-body text-body-sm text-red-600 dark:text-red-400">{r.error}</p>}
                {r.budget && <RunBudget budget={r.budget} subjects={r.subjects} />}
                {finished ? (
                <ol className="flex flex-wrap gap-y-2" aria-label={t('manage.wikiAi.runs.timeline')}>
                    {PIPELINE.map((st, i) => {
                      const state = finished && !/FAIL|CANCEL|BLOCK/i.test(r.status) ? 'done'
                        : i < currentIdx ? 'done' : i === currentIdx ? 'current' : 'todo'
                      const cost = costOf(st)
                      const batches = r.batches?.filter((b) => b.stage.toUpperCase() === st) ?? []
                      return (
                        <li key={st} className="flex items-center">
                          <div className={`flex flex-col items-start px-3 py-2 rounded-sm border ${
                            state === 'current' ? 'border-accent bg-accent-50 dark:bg-accent-900/30'
                              : state === 'done' ? 'border-border dark:border-night-border' : 'border-dashed border-border dark:border-night-border opacity-60'
                          }`}>
                            <span className="font-mono text-label uppercase tracking-widest">{t(`manage.wikiAi.stages.${st}`, { defaultValue: t('manage.wikiAi.stages.other') })}</span>
                            <span className="font-mono text-label text-ink-secondary dark:text-night-muted">
                              {cost != null ? usd(cost, 2) : ''}{batches.length ? ` · ${batches.map((b) => statusLabel(b.status, t)).join(', ')}` : ''}
                            </span>
                          </div>
                          {i < PIPELINE.length - 1 && <span className="mx-1 text-ink-secondary dark:text-night-muted" aria-hidden="true">→</span>}
                        </li>
                      )
                    })}
                  </ol>
                ) : (
                  <ProgressPanel
                    progress={progress}
                    stages={RUN_STAGES}
                    fallback={{ stage: r.stage, startedAt: r.startedAt, tokensIn: r.tokensIn, tokensOut: r.tokensOut, costUsd: r.costUsd ?? r.costEstimate }}
                  />
                )}
              </Panel>

              <Panel title={t('manage.wikiAi.runs.perSubject')}>
                {(r.subjects ?? []).length === 0 ? (
                  <EmptyState compact title={t('manage.wikiAi.runs.noSubjects')} />
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full font-body text-body-sm">
                      <thead><tr>
                        <th className={TH}>{t('manage.wikiAi.settings.subject')}</th>
                        <th className={TH}>{t('manage.wikiAi.runs.status')}</th>
                        <th className={TH}>{t('manage.wikiAi.runs.pages')}</th>
                        <th className={`${TH} text-right`}>{t('manage.wikiAi.runs.tokens')}</th>
                        <th className={`${TH} text-right`}>{t('manage.wikiAi.runs.cost')}</th>
                      </tr></thead>
                      <tbody>
                        {r.subjects.map((s: KbRunSubject) => {
                          const rejected = asList(s.rejected)
                          return (
                            <tr key={s.subjectId} className="border-t border-border dark:border-night-border align-top">
                              <td className={TD}>
                                <p><span className="font-mono text-label mr-1.5">{s.subjectId}</span>{s.subjectName}</p>
                                <p className="font-mono text-label text-ink-secondary dark:text-night-muted">
                                  +{s.added?.length ?? 0} ~{s.changed?.length ?? 0} −{s.removed?.length ?? 0}{s.model ? ` · ${s.model}` : ''}
                                </p>
                              </td>
                              <td className={TD}><StatusPill status={s.status} />{s.error && <p className={`mt-1 ${/DEFER/i.test(s.status) ? 'text-amber-700 dark:text-amber-300' : 'text-red-600 dark:text-red-400'}`}>{s.error}</p>}</td>
                              <td className={TD}>
                                <p>{t('manage.wikiAi.runs.pagesSummary', { created: countOps(s.operations, 'create', s.accepted), updated: countOps(s.operations, 'update', s.accepted), deleted: asList(s.deleted).length, rejected: rejected.length })}</p>
                                {rejected.length > 0 && (
                                  <details className="mt-1">
                                    <summary className="cursor-pointer font-mono text-label uppercase tracking-widest text-red-600 dark:text-red-400">{t('manage.wikiAi.runs.rejectedPages')}</summary>
                                    <ul className="mt-1 flex flex-col gap-1">
                                      {rejected.map((p, i) => (
                                        <li key={i}><code className="font-mono text-label">{p.slug}</code>: {(p.errors ?? []).join('; ')}</li>
                                      ))}
                                    </ul>
                                  </details>
                                )}
                              </td>
                              <td className={`${TD} text-right tabular-nums`}>{tokens((s.tokensIn ?? 0) + (s.tokensOut ?? 0))}</td>
                              <td className={`${TD} text-right tabular-nums`}>{usd(s.costUsd ?? null, 2)}</td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </Panel>

              {confirmCancel && (
                <ConfirmDialog
                  title={t('manage.wikiAi.runs.cancelTitle')}
                  body={t('manage.wikiAi.runs.cancelBody')}
                  confirmLabel={t('manage.wikiAi.runs.cancel')}
                  cancelLabel={t('manage.wikiAi.runs.keepRunning')}
                  busy={busy === 'cancel'}
                  error={error}
                  onConfirm={() => void act('cancel')}
                  onCancel={() => { setConfirmCancel(false); setError(null) }}
                />
              )}
            </>
          )
        }}
      </ViewState>
    </div>
  )
}

// Created/updated counts: from accepted entries ({op}) when present, else
// from the planned operations.
function countOps(operations: unknown, op: string, accepted: unknown): number {
  const acc = asList(accepted) as { op?: string }[]
  if (acc.length && acc.some((a) => a.op)) return acc.filter((a) => a.op === op).length
  const ops = (Array.isArray(operations) ? operations : (operations as { operations?: unknown[] } | null)?.operations) ?? []
  return (ops as { op?: string }[]).filter((o) => o?.op === op).length
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="font-mono text-label uppercase tracking-widest text-ink-secondary dark:text-night-muted">{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  )
}

function stageLabel(stage: string, t: TFunction): string {
  return t(`manage.wikiAi.stages.${stage.toUpperCase()}`, { defaultValue: t('manage.wikiAi.stages.other') })
}

// MANUAL | SCHEDULED | EVAL.
function triggerLabel(trigger: string | null | undefined, t: TFunction): string {
  if (!trigger) return '—'
  return t(`manage.wikiAi.runs.triggers.${trigger.toUpperCase()}`, { defaultValue: t('manage.wikiAi.runs.triggers.other') })
}
