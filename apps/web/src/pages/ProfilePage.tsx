import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { useThemeContext } from '../context/ThemeContext'
import { fetchCareersWithPlans, fetchMyProfile, patchMyProfile, type CareerWithPlans, type MeProfile } from '../api/profile'
import { getSession } from '../store/authStore'

export default function ProfilePage() {
  const { t, i18n } = useTranslation()
  const { profile, loading } = useAuth()
  const { theme, toggle } = useThemeContext()

  const [careers, setCareers] = useState<CareerWithPlans[]>([])
  const [me, setMe] = useState<MeProfile | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchCareersWithPlans().then(setCareers).catch((e: Error) => setError(e.message))
    fetchMyProfile().then(setMe).catch((e: Error) => setError(e.message))
  }, [])

  const plansForSelected = useMemo(() => {
    if (!me?.careerId) return []
    return careers.find((c) => c.id === me.careerId)?.plans ?? []
  }, [careers, me?.careerId])

  if (loading) return null
  if (!profile) return <Navigate to="/" replace />

  async function changeCareer(nextId: string) {
    setError(null); setBusy('career')
    try {
      const updated = await patchMyProfile({ careerId: nextId || null, plan: null })
      setMe(updated)
      void getSession({ force: true })
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  async function changePlan(nextPlan: string) {
    setError(null); setBusy('plan')
    try {
      const updated = await patchMyProfile({ plan: nextPlan || null })
      setMe(updated)
      void getSession({ force: true })
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  function changeLanguage(lang: 'es' | 'en') {
    if (i18n.language !== lang) i18n.changeLanguage(lang)
    // ThemeContext's i18n.on('languageChanged') effect handles server sync.
  }

  return (
    <main className="container-content py-section-mobile lg:py-section">
      <header className="mb-8">
        <h1 className="font-display font-bold text-h2 text-ink-primary dark:text-[#f4f4f5]">
          {t('profile.title')}
        </h1>
        <p className="font-body text-body text-ink-secondary dark:text-[#a1a1aa] mt-1">
          {t('profile.subtitle')}
        </p>
      </header>

      {error && (
        <p className="mb-6 px-3 py-2 rounded-sm bg-red-50 text-red-700 font-body text-body-sm border border-red-200">
          {error}
        </p>
      )}

      <section className="mb-8 p-5 rounded-card border border-border dark:border-[#3f3f46] bg-white dark:bg-[#27272a] flex items-center gap-4">
        {profile.avatarUrl ? (
          <img src={profile.avatarUrl} alt={profile.name ?? profile.email} className="w-16 h-16 rounded-full object-cover" />
        ) : (
          <div className="w-16 h-16 rounded-full bg-primary-100 dark:bg-primary-900 flex items-center justify-center font-display font-bold text-h4 text-primary">
            {(profile.name ?? profile.email).slice(0, 2).toUpperCase()}
          </div>
        )}
        <div className="min-w-0">
          <p className="font-display font-bold text-h4 text-ink-primary dark:text-[#f4f4f5] truncate">
            {profile.name ?? profile.email}
          </p>
          <p className="font-mono text-label uppercase tracking-widest text-ink-secondary dark:text-[#a1a1aa] truncate">
            {profile.email}
          </p>
          {me?.fileNumber != null && (
            <p className="font-mono text-label text-ink-secondary dark:text-[#a1a1aa] mt-1">
              {t('profile.fileNumber')}: {me.fileNumber}
            </p>
          )}
        </div>
      </section>

      <section className="mb-8">
        <h2 className="font-display font-bold text-h4 text-ink-primary dark:text-[#f4f4f5] mb-3">
          {t('profile.appearance')}
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label={t('profile.theme')}>
            <button
              type="button"
              onClick={toggle}
              className="px-3 py-1.5 rounded-sm border border-border dark:border-[#3f3f46] bg-white dark:bg-[#27272a] font-body text-body-sm w-full text-left"
            >
              {theme === 'dark' ? t('profile.themeDark') : t('profile.themeLight')}
            </button>
          </Field>
          <Field label={t('profile.language')}>
            <select
              value={i18n.language === 'en' ? 'en' : 'es'}
              onChange={(e) => changeLanguage(e.target.value as 'es' | 'en')}
              className="px-3 py-1.5 rounded-sm border border-border dark:border-[#3f3f46] bg-white dark:bg-[#27272a] font-body text-body-sm w-full"
            >
              <option value="es">Español</option>
              <option value="en">English</option>
            </select>
          </Field>
        </div>
      </section>

      <section>
        <h2 className="font-display font-bold text-h4 text-ink-primary dark:text-[#f4f4f5] mb-3">
          {t('profile.academics')}
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label={t('profile.career')}>
            <select
              value={me?.careerId ?? ''}
              disabled={busy === 'career'}
              onChange={(e) => changeCareer(e.target.value)}
              className="px-3 py-1.5 rounded-sm border border-border dark:border-[#3f3f46] bg-white dark:bg-[#27272a] font-body text-body-sm w-full"
            >
              <option value="">— {t('profile.unset')} —</option>
              {careers.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </Field>
          <Field label={t('profile.plan')}>
            <select
              value={me?.plan ?? ''}
              disabled={busy === 'plan' || !me?.careerId}
              onChange={(e) => changePlan(e.target.value)}
              className="px-3 py-1.5 rounded-sm border border-border dark:border-[#3f3f46] bg-white dark:bg-[#27272a] font-body text-body-sm w-full disabled:opacity-50"
            >
              <option value="">— {t('profile.unset')} —</option>
              {plansForSelected.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </Field>
        </div>
        {me?.careerId == null && (
          <p className="mt-2 font-mono text-label uppercase tracking-widest text-ink-secondary dark:text-[#a1a1aa]">
            {t('profile.pickCareerFirst')}
          </p>
        )}
      </section>
    </main>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="font-mono text-label uppercase tracking-widest text-ink-secondary dark:text-[#a1a1aa]">{label}</span>
      {children}
    </label>
  )
}
