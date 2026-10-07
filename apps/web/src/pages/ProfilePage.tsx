import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { useThemeContext } from '../context/useThemeContext'
import { fetchCareersWithPlans, fetchMyProfile, patchMyProfile, type CareerWithPlans, type MeProfile } from '../api/profile'
import { getSession } from '../store/authStore'
import { safeHttpUrl } from '../utils/url'
import { ErrorState, Field, Skeleton, SkeletonForm, ToggleGroup, selectClass, toast } from '../components/ui'

export default function ProfilePage() {
  const { t, i18n } = useTranslation()
  const { profile, loading } = useAuth()
  const { theme, toggle } = useThemeContext()

  const [careers, setCareers] = useState<CareerWithPlans[]>([])
  const [me, setMe] = useState<MeProfile | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)

  const load = useCallback(() => {
    setLoadFailed(false)
    Promise.all([fetchCareersWithPlans(), fetchMyProfile()])
      .then(([c, m]) => { setCareers(c); setMe(m) })
      .catch((e) => { console.error(e); setLoadFailed(true) })
  }, [])

  useEffect(() => { load() }, [load])

  const plansForSelected = useMemo(() => {
    if (!me?.careerId) return []
    return careers.find((c) => c.id === me.careerId)?.plans ?? []
  }, [careers, me?.careerId])

  if (loading) {
    return (
      <main id="main-content" tabIndex={-1} className="outline-none container-content py-section-mobile lg:py-section">
        <Skeleton className="h-10 w-48 mb-8" />
        <SkeletonForm fields={3} />
      </main>
    )
  }
  if (!profile) return <Navigate to="/" replace />
  const avatarUrl = safeHttpUrl(profile.avatarUrl)

  async function save(field: 'career' | 'plan', payload: Parameters<typeof patchMyProfile>[0]) {
    setBusy(field)
    try {
      const updated = await patchMyProfile(payload)
      setMe(updated)
      void getSession({ force: true })
      toast.success(t('profile.saved'))
    } catch (e) {
      console.error(e)
      toast.error(t('profile.saveError'))
    } finally {
      setBusy(null)
    }
  }

  function changeLanguage(lang: 'es' | 'en') {
    if (i18n.language !== lang) i18n.changeLanguage(lang)
    // ThemeContext's i18n.on('languageChanged') effect handles server sync.
  }

  return (
    <main id="main-content" tabIndex={-1} className="outline-none container-content py-section-mobile lg:py-section">
      <header className="mb-8">
        <h1 className="font-display font-bold text-h2 text-ink-primary dark:text-night-text">
          {t('profile.title')}
        </h1>
        <p className="font-body text-body text-ink-secondary dark:text-night-muted mt-1">
          {t('profile.subtitle')}
        </p>
      </header>

      <section className="mb-8 p-5 rounded-card border border-border dark:border-night-border bg-white dark:bg-night-surface flex items-center gap-4">
        {avatarUrl ? (
          <img src={avatarUrl} alt="" className="w-16 h-16 rounded-full object-cover" />
        ) : (
          <div className="w-16 h-16 rounded-full bg-primary-100 dark:bg-primary-900 flex items-center justify-center font-display font-bold text-h4 text-primary dark:text-primary-200" aria-hidden="true">
            {(profile.name ?? profile.email).slice(0, 2).toUpperCase()}
          </div>
        )}
        <div className="min-w-0">
          <p className="font-display font-bold text-h4 text-ink-primary dark:text-night-text truncate">
            {profile.name ?? profile.email}
          </p>
          <p className="font-body text-body-sm text-ink-secondary dark:text-night-muted truncate">
            {profile.email}
          </p>
          {me?.fileNumber != null && (
            <p className="font-mono text-label text-ink-secondary dark:text-night-muted mt-1">
              {t('profile.fileNumberValue', { number: me.fileNumber })}
            </p>
          )}
        </div>
      </section>

      <section className="mb-8">
        <h2 className="font-display font-bold text-h4 text-ink-primary dark:text-night-text mb-3">
          {t('profile.appearance')}
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          <div className="flex flex-col gap-1.5">
            <span id="profile-theme-label" className="font-mono text-label uppercase tracking-widest text-ink-secondary dark:text-night-muted">
              {t('profile.theme')}
            </span>
            <ToggleGroup
              joined
              labelledBy="profile-theme-label"
              className="w-full"
              value={theme}
              onChange={(next) => { if (next !== theme) toggle() }}
              options={[
                { value: 'light', label: t('profile.themeLight') },
                { value: 'dark', label: t('profile.themeDark') },
              ]}
            />
          </div>
          <Field label={t('profile.language')}>
            {(p) => (
              <select
                {...p}
                value={i18n.language === 'en' ? 'en' : 'es'}
                onChange={(e) => changeLanguage(e.target.value as 'es' | 'en')}
                className={selectClass()}
              >
                <option value="es">Español</option>
                <option value="en">English</option>
              </select>
            )}
          </Field>
        </div>
      </section>

      <section>
        <h2 className="font-display font-bold text-h4 text-ink-primary dark:text-night-text mb-3">
          {t('profile.academics')}
        </h2>
        {loadFailed ? (
          <ErrorState compact message={t('profile.loadError')} onRetry={load} />
        ) : me == null ? (
          <SkeletonForm fields={2} className="sm:grid sm:grid-cols-2 sm:gap-5" />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <Field label={t('profile.career')} hint={busy === 'career' ? t('profile.saving') : undefined}>
              {(p) => (
                <select
                  {...p}
                  value={me.careerId ?? ''}
                  disabled={busy === 'career'}
                  onChange={(e) => void save('career', { careerId: e.target.value || null, plan: null })}
                  className={selectClass()}
                >
                  <option value="">— {t('profile.unset')} —</option>
                  {careers.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              )}
            </Field>
            <Field
              label={t('profile.plan')}
              hint={me.careerId == null ? t('profile.pickCareerFirst') : busy === 'plan' ? t('profile.saving') : undefined}
            >
              {(p) => (
                <select
                  {...p}
                  value={me.plan ?? ''}
                  disabled={busy === 'plan' || !me.careerId}
                  onChange={(e) => void save('plan', { plan: e.target.value || null })}
                  className={selectClass()}
                >
                  <option value="">— {t('profile.unset')} —</option>
                  {plansForSelected.map((pl) => (
                    <option key={pl.id} value={pl.id}>{pl.name}</option>
                  ))}
                </select>
              )}
            </Field>
          </div>
        )}
      </section>
    </main>
  )
}
