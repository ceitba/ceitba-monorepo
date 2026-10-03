import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  approveRunCost, cancelRun, costPairs, fetchPreview, fetchRun, fetchRuns, startRun, type KbRun, type KbRunSubject,
} from '../../../api/kbAdmin'
import { ApiError } from '../../../api/client'
import { apuntesErrorMessage } from '../../../utils/apuntes'
import ConfirmDialog from '../../../components/ConfirmDialog'
import ErrorBanner from '../../../components/ErrorBanner'
import Modal from '../../../components/Modal'
import Notice from '../../../components/Notice'
import { BTN, BTN_DANGER, BTN_PRI, Panel, StatusPill, TD, TH, ViewState, duration, tokens, usd, useLoad } from './shared'

const PIPELINE: string[] = ['DETECT', 'DIGEST', 'PLAN', 'WRITE', 'RETRY', 'LINK', 'VALIDATE', 'PUBLISH']
const ACTIVE = /RUNNING|PENDING|SUBMITTED|IN_PROGRESS|QUEUED|VALIDATING|BLOCKED/i

// Ejecuciones: list + detail, run now / dry run / preview, cancel, approve
// cost for BLOCKED_BY_COST_LIMIT runs.
export default function RunsView({ openId, onOpen }: { openId: string | null; onOpen: (id: string | null) => void }) {
  const { t, i18n } = useTranslation()
  const runs = useLoad(() => fetchRuns(30))
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [confirmRun, setConfirmRun] = useState<null | 'real' | 'dry'>(null)
  const [preview, setPreview] = useState(false)

  async function start(dry: boolean) {
    setError(null); setNotice(null); setBusy('start')
    try {
      const run = await startRun(dry)
      setNotice(dry ? t('manage.wikiAi.runs.dryStarted') : t('manage.wikiAi.runs.started'))
      runs.reload()
      if (run?.id) onOpen(run.id)
    } catch (e) {
      setError(e instanceof ApiError && e.status === 409 ? t('manage.wikiAi.runs.alreadyActive') : apuntesErrorMessage(e, t))
    } finally {
      setBusy(null); setConfirmRun(null)
    }
  }

  if (openId) return <RunDetail id={openId} onBack={() => { onOpen(null); runs.reload() }} />

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" disabled={busy === 'start'} onClick={() => setConfirmRun('real')} className={BTN_PRI}>{t('manage.wikiAi.runs.runNow')}</button>
        <button type="button" disabled={busy === 'start'} onClick={() => setConfirmRun('dry')} className={BTN}>{t('manage.wikiAi.runs.dryRun')}</button>
        <button type="button" onClick={() => setPreview(true)} className={BTN}>{t('manage.wikiAi.runs.preview')}</button>
        <button type="button" onClick={runs.reload} className="ml-auto font-mono text-label uppercase tracking-widest text-ink-secondary dark:text-night-muted hover:text-primary">{t('manage.wikiAi.refresh')}</button>
      </div>
      {error && <ErrorBanner onDismiss={() => setError(null)}>{error}</ErrorBanner>}
      {notice && <Notice onDismiss={() => setNotice(null)}>{notice}</Notice>}
      <ViewState state={runs} skeleton="rows" empty={(r) => r.length === 0} emptyText={t('manage.wikiAi.runs.empty')}>
        {(list) => (
          <div className="overflow-x-auto rounded-card border border-border dark:border-night-border">
            <table className="w-full font-body text-body-sm">
              <thead className="bg-page-bg dark:bg-night-bg"><tr>
                <th className={TH}>{t('manage.wikiAi.runs.started_')}</th>
                <th className={TH}>{t('manage.wikiAi.runs.status')}</th>
                <th className={TH}>{t('manage.wikiAi.runs.trigger')}</th>
                <th className={`${TH} text-right`}>{t('manage.wikiAi.runs.subjects')}</th>
                <th className={`${TH} text-right`}>Tokens</th>
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
                        {r.stage && <span className="font-mono text-label text-ink-secondary dark:text-night-muted">{r.stage}</span>}
                        {r.dryRun && <span className="font-mono text-label uppercase text-ink-secondary dark:text-night-muted">{t('manage.wikiAi.runs.dry')}</span>}
                        {r.simulated && <span className="font-mono text-label uppercase text-amber-700 dark:text-amber-300">{t('manage.wikiAi.simulatedShort')}</span>}
                      </div>
                    </td>
                    <td className={`${TD} font-mono text-label`}>{r.trigger}</td>
                    <td className={`${TD} text-right tabular-nums`}>{r.subjects?.length ?? 0}</td>
                    <td className={`${TD} text-right tabular-nums`}>{tokens((r.tokensIn ?? 0) + (r.tokensOut ?? 0))}</td>
                    <td className={`${TD} text-right tabular-nums`}>
                      {usd(r.costUsd ?? r.costEstimate, 2)}
                      {r.expectedCostUsd != null && (
                        <span className="block font-mono text-[0.68rem] text-ink-secondary dark:text-night-muted">{t('manage.wikiAi.forecast.expectedShort', { cost: usd(r.expectedCostUsd, 2) })}</span>
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
          title={confirmRun === 'dry' ? t('manage.wikiAi.runs.dryRun') : t('manage.wikiAi.runs.runNow')}
          body={confirmRun === 'dry' ? t('manage.wikiAi.runs.dryBody') : t('manage.wikiAi.runs.runBody')}
          confirmLabel={confirmRun === 'dry' ? t('manage.wikiAi.runs.dryRun') : t('manage.wikiAi.runs.runNow')}
          danger={false}
          busy={busy === 'start'}
          onConfirm={() => void start(confirmRun === 'dry')}
          onCancel={() => setConfirmRun(null)}
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
    <Modal title={t('manage.wikiAi.runs.preview')} onClose={onClose} size="2xl" footer={<button type="button" onClick={onClose} className={BTN_PRI}>{t('manage.wikiAi.close')}</button>}>
      <ViewState state={p} skeleton="rows">
        {(d) => (
          <div className="flex flex-col gap-3 font-body text-body-sm">
            <p className="text-ink-secondary dark:text-night-muted">
              {t('manage.wikiAi.runs.previewSummary', { dirty: d.dirty.length, clean: d.cleanSubjects, tokens: tokens(d.estimatedTokens), budget: tokens(d.tokenBudget) })}
            </p>
            {d.estimatedTokens > d.tokenBudget && <p className="text-amber-700 dark:text-amber-300">{t('manage.wikiAi.runs.overBudget')}</p>}
            {d.dirty.length === 0 ? (
              <p className="py-4 text-center text-ink-secondary dark:text-night-muted">{t('manage.wikiAi.runs.nothingToDo')}</p>
            ) : (
              <ul className="flex flex-col divide-y divide-border dark:divide-night-border max-h-[50vh] overflow-y-auto">
                {d.dirty.map((s) => (
                  <li key={s.subjectId} className="py-2">
                    <p className="font-semibold"><span className="font-mono text-label mr-1.5">{s.subjectId}</span>{s.subjectName}</p>
                    <p className="text-ink-secondary dark:text-night-muted">
                      {t('manage.wikiAi.runs.diff', { added: s.added.length, changed: s.changed.length, removed: s.removed.length, digests: s.digestsNeeded, tokens: tokens(s.estimatedTokens) })}
                    </p>
                    {[...s.added, ...s.changed].length > 0 && (
                      <p className="font-mono text-[0.72rem] text-ink-secondary dark:text-night-muted truncate">{[...s.added, ...s.changed].map((f) => f.name).join(' · ')}</p>
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

function asList(v: unknown): { slug?: string; errors?: string[]; title?: string }[] {
  if (Array.isArray(v)) return v.map((x) => (typeof x === 'string' ? { slug: x } : (x as { slug?: string; errors?: string[] })))
  return []
}

function RunDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const { t, i18n } = useTranslation()
  const run = useLoad(() => fetchRun(id), [id])
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirmCancel, setConfirmCancel] = useState(false)

  async function act(kind: 'cancel' | 'approve') {
    setError(null); setBusy(kind)
    try {
      const r = kind === 'cancel' ? await cancelRun(id) : await approveRunCost(id)
      if (r?.id) run.setData(() => r)
      else run.reload()
    } catch (e) {
      setError(apuntesErrorMessage(e, t))
    } finally {
      setBusy(null); setConfirmCancel(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <button type="button" onClick={onBack} className="self-start font-mono text-label uppercase tracking-widest text-ink-secondary dark:text-night-muted hover:text-primary">← {t('manage.wikiAi.runs.back')}</button>
      {error && <ErrorBanner onDismiss={() => setError(null)}>{error}</ErrorBanner>}
      <ViewState state={run}>
        {(r: KbRun) => {
          const stageCost = costPairs(r.costByStage ?? null)
          const batchCost = new Map<string, number>()
          r.batches?.forEach((b) => { if (b.costUsd != null) batchCost.set(b.stage, (batchCost.get(b.stage) ?? 0) + b.costUsd) })
          const costOf = (st: string) => stageCost.find(([k]) => k.toUpperCase() === st)?.[1] ?? batchCost.get(st)
          const currentIdx = r.stage ? PIPELINE.indexOf(r.stage.toUpperCase()) : -1
          const finished = !ACTIVE.test(r.status)
          return (
            <>
              <Panel
                title={<span className="flex flex-wrap items-center gap-2">{t('manage.wikiAi.runs.run')} <StatusPill status={r.status} />{r.dryRun && <span className="font-mono text-label uppercase text-ink-secondary">{t('manage.wikiAi.runs.dry')}</span>}</span>}
                actions={
                  <div className="flex flex-wrap gap-2">
                    {/BLOCKED_BY_COST_LIMIT/i.test(r.status) && (
                      <button type="button" onClick={() => act('approve')} disabled={!!busy} className={BTN_PRI}>{busy === 'approve' ? '…' : t('manage.wikiAi.runs.approveCost')}</button>
                    )}
                    {!finished && <button type="button" onClick={() => setConfirmCancel(true)} disabled={!!busy} className={BTN_DANGER}>{t('manage.wikiAi.runs.cancel')}</button>}
                    <button type="button" onClick={run.reload} className={BTN}>{t('manage.wikiAi.refresh')}</button>
                  </div>
                }
              >
                <dl className="grid grid-cols-2 md:grid-cols-4 gap-3 font-body text-body-sm mb-4">
                  <Info label={t('manage.wikiAi.runs.trigger')} value={r.trigger} />
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
                          <span className="font-mono text-label uppercase tracking-widest">{t(`manage.wikiAi.stages.${st}`, { defaultValue: st })}</span>
                          <span className="font-mono text-[0.68rem] text-ink-secondary dark:text-night-muted">
                            {cost != null ? usd(cost, 2) : ''}{batches.length ? ` · ${batches.map((b) => b.status).join(', ')}` : ''}
                          </span>
                        </div>
                        {i < PIPELINE.length - 1 && <span className="mx-1 text-ink-secondary dark:text-night-muted" aria-hidden="true">→</span>}
                      </li>
                    )
                  })}
                </ol>
              </Panel>

              <Panel title={t('manage.wikiAi.runs.perSubject')}>
                {(r.subjects ?? []).length === 0 ? (
                  <p className="py-4 text-center font-body text-body-sm text-ink-secondary dark:text-night-muted">{t('manage.wikiAi.runs.noSubjects')}</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full font-body text-body-sm">
                      <thead><tr>
                        <th className={TH}>{t('manage.wikiAi.settings.subject')}</th>
                        <th className={TH}>{t('manage.wikiAi.runs.status')}</th>
                        <th className={TH}>{t('manage.wikiAi.runs.pages')}</th>
                        <th className={`${TH} text-right`}>Tokens</th>
                        <th className={`${TH} text-right`}>{t('manage.wikiAi.runs.cost')}</th>
                      </tr></thead>
                      <tbody>
                        {r.subjects.map((s: KbRunSubject) => {
                          const rejected = asList(s.rejected)
                          return (
                            <tr key={s.subjectId} className="border-t border-border dark:border-night-border align-top">
                              <td className={TD}>
                                <p><span className="font-mono text-label mr-1.5">{s.subjectId}</span>{s.subjectName}</p>
                                <p className="font-mono text-[0.7rem] text-ink-secondary dark:text-night-muted">
                                  +{s.added?.length ?? 0} ~{s.changed?.length ?? 0} −{s.removed?.length ?? 0}{s.model ? ` · ${s.model}` : ''}
                                </p>
                              </td>
                              <td className={TD}><StatusPill status={s.status} />{s.error && <p className="text-red-600 dark:text-red-400 mt-1">{s.error}</p>}</td>
                              <td className={TD}>
                                <p>{t('manage.wikiAi.runs.pagesSummary', { created: countOps(s.operations, 'create', s.accepted), updated: countOps(s.operations, 'update', s.accepted), deleted: asList(s.deleted).length, rejected: rejected.length })}</p>
                                {rejected.length > 0 && (
                                  <details className="mt-1">
                                    <summary className="cursor-pointer font-mono text-label uppercase tracking-widest text-red-600 dark:text-red-400">{t('manage.wikiAi.runs.rejectedPages')}</summary>
                                    <ul className="mt-1 flex flex-col gap-1">
                                      {rejected.map((p, i) => (
                                        <li key={i}><code className="font-mono text-[0.75rem]">{p.slug}</code>: {(p.errors ?? []).join('; ')}</li>
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
                  title={t('manage.wikiAi.runs.cancel')}
                  body={t('manage.wikiAi.runs.cancelBody')}
                  confirmLabel={t('manage.wikiAi.runs.cancel')}
                  busy={busy === 'cancel'}
                  onConfirm={() => void act('cancel')}
                  onCancel={() => setConfirmCancel(false)}
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
