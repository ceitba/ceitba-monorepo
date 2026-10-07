import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { CAREERS, CAREER_METADATA, EXCHANGE_CAREER, getLatestPlan } from '../types/careers'
import { normalizePlanId } from '../utils/planUtils'
import SchedulerHeader from '../components/SchedulerHeader'
import { schedulerPath } from '../paths'

// Reasons CEITBA-API puts in ?error= when sign-in fails (AuthController /
// LoginRejectedException; access_denied = the user cancelled Google consent).
// AuthCallback forwards them here as ?authError=.
const AUTH_ERROR_CODES = ['unauthorized', 'unauthorized_workspace', 'unverified_email', 'auth_failed', 'invalid_state', 'access_denied']

function CareerCard({ id, name }: { id: string; name: string }) {
  const { t } = useTranslation()
  const planParam = normalizePlanId(getLatestPlan(id))
  const icon = CAREER_METADATA[id]?.icon

  return (
    <Link
      to={schedulerPath(`/${id}?plan=${planParam}`)}
      className="rounded-card border border-border dark:border-night-border bg-white dark:bg-night-surface shadow-card hover:shadow-card-hover transition-shadow duration-200 flex flex-col p-5 group"
      aria-label={`${t('home.viewSchedules')} ${name}`}
    >
      <div className="flex items-center justify-between mb-2">
        <span className="font-mono text-label uppercase tracking-widest text-ink-secondary dark:text-night-muted">{id}</span>
        {icon && <span className="text-lg leading-none" aria-hidden="true">{icon}</span>}
      </div>
      <h2 className="font-display text-h5 font-bold text-ink-primary dark:text-night-text group-hover:text-primary transition-colors duration-150 leading-snug flex-1">
        {name}
      </h2>
      <div className="flex items-center gap-1.5 text-primary font-body text-body-sm mt-4 pt-3 border-t border-border dark:border-night-border">
        <span>{t('home.viewSchedules')}</span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <path d="M5 12h14M12 5l7 7-7 7" />
        </svg>
      </div>
    </Link>
  )
}

export default function HomePage() {
  const { t } = useTranslation()
  const [searchParams, setSearchParams] = useSearchParams()
  const [authError, setAuthError] = useState<string | null>(() => {
    const code = searchParams.get('authError')
    if (!code) return null
    return AUTH_ERROR_CODES.includes(code) ? code : 'auth_failed'
  })

  // Strip ?authError= so a reload or shared URL doesn't show it again.
  useEffect(() => {
    if (!searchParams.has('authError')) return
    const next = new URLSearchParams(searchParams)
    next.delete('authError')
    setSearchParams(next, { replace: true })
  }, [searchParams, setSearchParams])

  const careersList = Object.entries(CAREERS).map(([id, name]) => ({ id, name }))

  return (
    <div className="flex flex-col bg-surface dark:bg-night-bg">
      <SchedulerHeader />

      <main id="main-content" className="flex-1">
        <section className="container-content py-section-mobile lg:py-section">
          {authError && (
            <div
              role="alert"
              className="mb-8 flex items-start gap-3 px-4 py-3 rounded-card border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20"
            >
              <div className="flex-1 min-w-0">
                <p className="font-body font-semibold text-body-sm text-red-800 dark:text-red-200">{t('authErrors.title')}</p>
                <p className="font-body text-body-sm text-red-700 dark:text-red-300">{t(`authErrors.${authError}`)}</p>
              </div>
              <button
                type="button"
                onClick={() => setAuthError(null)}
                aria-label={t('authErrors.dismiss')}
                className="text-red-700 dark:text-red-300 hover:text-red-900 dark:hover:text-red-100"
              >
                ×
              </button>
            </div>
          )}
          <div className="mb-10">
            <h1 className="font-display text-h1 lg:text-display font-bold text-ink-primary dark:text-night-text leading-tight mb-3">
              {t('home.title')}
            </h1>
            <p className="font-body text-body-lg text-ink-secondary dark:text-night-muted max-w-xl">
              {t('home.subtitle')}
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 animate-fade-in">
            {careersList.map(career => (
              <CareerCard key={career.id} id={career.id} name={career.name} />
            ))}
          </div>

          <div className="mt-8 pt-8 border-t border-border dark:border-night-border">
            <Link
              to={schedulerPath(`/${EXCHANGE_CAREER.id}?plan=${normalizePlanId(getLatestPlan(EXCHANGE_CAREER.id))}`)}
              className="inline-flex items-center gap-4 rounded-card border border-dashed border-primary/40 hover:border-primary bg-white dark:bg-night-surface px-6 py-4 transition-colors duration-150 group"
              aria-label={t('home.viewSchedules')}
            >
              {EXCHANGE_CAREER.icon && <span className="text-2xl leading-none flex-shrink-0" aria-hidden="true">{EXCHANGE_CAREER.icon}</span>}
              <div>
                <span className="font-mono text-label uppercase tracking-widest text-ink-secondary dark:text-night-muted block mb-0.5">{EXCHANGE_CAREER.id}</span>
                <p className="font-display text-h5 font-bold text-ink-primary dark:text-night-text group-hover:text-primary transition-colors duration-150">
                  {t('home.exchange.name')}
                </p>
                <p className="font-body text-body-sm text-ink-secondary dark:text-night-muted">{t('home.exchange.description')}</p>
              </div>
              <svg className="ml-auto w-5 h-5 text-primary flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <path d="M5 12h14M12 5l7 7-7 7" />
              </svg>
            </Link>
          </div>
        </section>
      </main>

    </div>
  )
}
