import '../../i18nApuntes'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'
import { loadCorrModel, type CorrModel } from '../../utils/correlatividades'
import { apuntesErrorMessage } from '../../utils/apuntes'
import EmptyState from '../../components/apuntes/EmptyState'
import CorrelativasMap from '../../components/apuntes/correlativas/CorrelativasMap'
import PinNotice from '../../components/apuntes/PinNotice'
import { BTN_PRIMARY } from '../../components/apuntes/buttons'

// /apuntes/correlativas — the student's plan as a prerequisite map.
export default function CorrelativasPage() {
  const { t } = useTranslation()
  const { profile } = useAuth()
  const plan = profile?.plan ?? null
  const [model, setModel] = useState<CorrModel | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!plan) return
    let cancelled = false
    setModel(null); setError(null)
    loadCorrModel(plan)
      .then((m) => { if (!cancelled) setModel(m) })
      .catch((e) => { if (!cancelled) setError(apuntesErrorMessage(e, t)) })
    return () => { cancelled = true }
  }, [plan, t])

  return (
    <main id="main-content" tabIndex={-1} className="outline-none container-content py-section-mobile lg:py-12">
      <nav aria-label={t('apuntes.breadcrumbAria')} className="mb-4 font-mono text-label uppercase tracking-widest text-ink-secondary dark:text-night-muted flex flex-wrap items-center gap-x-2">
        <Link to="/apuntes" className="hover:text-primary">{t('apuntes.title')}</Link>
        <span aria-hidden="true">/</span>
        <span>{t('apuntes.corr.title')}</span>
      </nav>
      <header className="mb-6">
        <h1 className="font-display font-bold text-h3 lg:text-h2 text-ink-primary dark:text-night-text">{t('apuntes.corr.title')}</h1>
        <p className="font-body text-body text-ink-secondary dark:text-night-muted mt-2 max-w-3xl">
          {plan ? t('apuntes.corr.subtitle', { plan }) : t('apuntes.corr.noPlan')}
        </p>
      </header>

      {!plan && (
        <EmptyState
          title={t('apuntes.corr.noPlanTitle')}
          body={t('apuntes.corr.noPlan')}
          action={<Link to="/profile" className={BTN_PRIMARY}>{t('apuntes.home.mineNoPlanLink')}</Link>}
        />
      )}
      {error && <p role="alert" className="font-body text-body-sm text-red-600 dark:text-red-400">{error}</p>}
      {plan && !model && !error && <div className="h-[60vh] rounded-card skeleton" aria-busy="true" />}
      {model && model.nodes.size === 0 && <EmptyState title={t('apuntes.corr.emptyTitle')} />}
      {model && model.nodes.size > 0 && <CorrelativasMap model={model} />}
      <PinNotice />
    </main>
  )
}
