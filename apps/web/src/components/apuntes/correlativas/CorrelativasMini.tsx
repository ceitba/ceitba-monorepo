import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { useAuth } from '../../../hooks/useAuth'
import { usePins } from '../../../hooks/usePins'
import { edgePath, layoutColumns, loadCorrModel, type CorrModel } from '../../../utils/correlatividades'
import { BTN_PRIMARY } from '../buttons'

// "Mapa de correlatividades" card on /apuntes: a small static picture of
// the student's plan (cards as blocks, prerequisite curves) and a link to
// the full map. Without a plan it asks to set one in the profile.
export default function CorrelativasMini() {
  const { t } = useTranslation()
  const { profile } = useAuth()
  const plan = profile?.plan ?? null
  const [model, setModel] = useState<CorrModel | null>(null)
  const [failed, setFailed] = useState(false)
  const { pins } = usePins()
  const pinnedWiki = useMemo(() => new Set((pins ?? []).filter((p) => p.hasWiki).map((p) => p.subjectId)), [pins])

  useEffect(() => {
    if (!plan) return
    let cancelled = false
    loadCorrModel(plan).then((m) => { if (!cancelled) setModel(m) }).catch(() => { if (!cancelled) setFailed(true) })
    return () => { cancelled = true }
  }, [plan])

  const layout = useMemo(() => (model ? layoutColumns(model, { cardW: 120, cardH: 30, colGap: 44, rowGap: 10, header: 0, pad: 8 }) : null), [model])
  if (failed || (plan && model && model.columns.length === 0)) return null

  return (
    <section aria-labelledby="apuntes-corr-heading" className="mb-10 rounded-card border border-border dark:border-night-border bg-white dark:bg-night-surface overflow-hidden">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 px-5 pt-4 pb-3">
        <div>
          <h2 id="apuntes-corr-heading" className="font-display font-bold text-h5 text-ink-primary dark:text-night-text">{t('apuntes.corr.title')}</h2>
          <p className="font-body text-body-sm text-ink-secondary dark:text-night-muted">
            {plan ? t('apuntes.corr.miniHint', { plan }) : t('apuntes.corr.noPlan')}
          </p>
          {plan && (
            <p className="mt-1 flex flex-wrap items-center gap-x-3 font-mono text-label text-ink-secondary dark:text-night-muted" aria-hidden="true">
              <span className="inline-flex items-center gap-1"><svg width="9" height="9"><rect width="9" height="9" rx="1.5" className="corr-mini-wiki" /></svg>{t('apuntes.corr.miniWiki')}</span>
              <span className="inline-flex items-center gap-1"><svg width="9" height="9"><circle cx="4.5" cy="4.5" r="3.5" className="corr-mini-dot" /></svg>{t('apuntes.corr.miniFiles')}</span>
            </p>
          )}
        </div>
        {plan ? (
          <Link to="/apuntes/correlativas" className={`${BTN_PRIMARY} self-start sm:self-auto`}>{t('apuntes.corr.open')}</Link>
        ) : (
          <Link to="/profile" className={`${BTN_PRIMARY} self-start sm:self-auto`}>{t('apuntes.home.mineNoPlanLink')}</Link>
        )}
      </div>
      {plan && (
        <Link to="/apuntes/correlativas" tabIndex={-1} aria-hidden="true" className="block px-3 pb-3">
          {model && layout ? (
            <svg viewBox={`0 0 ${layout.width} ${layout.height}`} className="w-full h-auto max-h-64" preserveAspectRatio="xMidYMid meet">
              {model.columns.flatMap((c) => c.ids).flatMap((id) => {
                return (model.nodes.get(id)?.deps ?? []).map((dep) => {
                  const d = edgePath(dep, id, layout)
                  return d ? <path key={`${dep}>${id}`} d={d} className="corr-edge" /> : null
                })
              })}
              {model.columns.flatMap((c) => c.ids).map((id) => {
                const p = layout.pos.get(id)!
                const n = model.nodes.get(id)!
                return (
                  <g key={id} transform={`translate(${p.x},${p.y})`}>
                    <rect width={layout.cardW} height={layout.cardH} rx="5" className="corr-mini-card" />
                    <text x="7" y={layout.cardH / 2} dy="0.35em" className="corr-mini-text">{id}</text>
                    {(n.hasWiki || pinnedWiki.has(id)) ? (
                      <rect x={layout.cardW - 13} y={layout.cardH / 2 - 4} width="8" height="8" rx="1.5" className="corr-mini-wiki" />
                    ) : n.fileCount > 0 ? (
                      <circle cx={layout.cardW - 9} cy={layout.cardH / 2} r="3.5" className="corr-mini-dot" />
                    ) : null}
                  </g>
                )
              })}
            </svg>
          ) : (
            <div className="h-40 rounded-sm skeleton" />
          )}
        </Link>
      )}
    </section>
  )
}
