import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { useAuth } from '../../../hooks/useAuth'
import { loadCorrModel, type CorrModel } from '../../../utils/correlatividades'

// One-line "Correlativas" summary for a subject page header, from the
// student's plan: direct prerequisites and what it unlocks. Renders nothing
// when the subject isn't in the plan (or there is no plan).
export default function SubjectCorrelativas({ subjectId }: { subjectId: string }) {
  const { t } = useTranslation()
  const { profile } = useAuth()
  const plan = profile?.plan ?? null
  const [model, setModel] = useState<CorrModel | null>(null)

  useEffect(() => {
    if (!plan) return
    let cancelled = false
    loadCorrModel(plan).then((m) => { if (!cancelled) setModel(m) }).catch(() => {})
    return () => { cancelled = true }
  }, [plan])

  const node = model?.nodes.get(subjectId)
  if (!model || !node) return null

  const links = (ids: string[]) => ids.map((id, i) => (
    <span key={id}>
      {i > 0 && ', '}
      <Link to={`/apuntes/${encodeURIComponent(id)}`} title={model.nodes.get(id)?.name} className="text-primary hover:underline">
        <span className="font-mono text-label mr-1">{id}</span>{model.nodes.get(id)?.name}
      </Link>
    </span>
  ))

  return (
    <div className="mt-3 flex flex-col gap-1 font-body text-body-sm text-ink-secondary dark:text-night-muted">
      <p>
        <span className="font-mono text-label uppercase tracking-widest mr-2">{t('apuntes.corr.requires')}</span>
        {node.deps.length ? links(node.deps) : t('apuntes.corr.noDeps')}
        {node.creditsRequired > 0 && ` · ${t('apuntes.corr.credits', { count: node.creditsRequired })}`}
      </p>
      {node.dependents.length > 0 && (
        <p>
          <span className="font-mono text-label uppercase tracking-widest mr-2">{t('apuntes.corr.unlocks')}</span>
          {links(node.dependents)}
        </p>
      )}
      <Link to="/apuntes/correlativas" className="self-start font-mono text-label uppercase tracking-widest text-ink-secondary dark:text-night-muted hover:text-primary">
        {t('apuntes.corr.seeMap')} →
      </Link>
    </div>
  )
}
