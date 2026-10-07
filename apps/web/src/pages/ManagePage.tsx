import { lazy, Suspense, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, Navigate, NavLink, Route, Routes, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { SkeletonTable } from '../components/ui'
import ManageBenefitsSection from './manage/ManageBenefitsSection'
import ManageUsersSection from './manage/ManageUsersSection'
import ManageCorrectionsSection from './manage/ManageCorrectionsSection'
import ManageOrganizationsSection from './manage/ManageOrganizationsSection'
import ManageCapabilitiesSection from './manage/ManageCapabilitiesSection'
import ManageReviewSection from './manage/review/ManageReviewSection'
import { ReviewQueueContext, useQueue } from './manage/review/queueContext'
import { useReviewQueue, type QueueKind } from './manage/review/useReviewQueue'
import { HOME_AREA, LEGACY_TABS, RAIL, areaPath, isArea, type Area } from './manage/areas'
import { activeJobs, unseenCount } from './manage/wikiAdmin/jobWatchStore'
import { useJobWatch } from './manage/wikiAdmin/useJobWatch'
import type { OrganizationSummary } from '../api/admin'

// Apuntes moderation pulls in the Drive/wiki APIs and badges: load on demand.
const ManageDriveSection = lazy(() => import('./manage/ManageDriveSection'))
const ManageWikiAiSection = lazy(() => import('./manage/ManageWikiAiSection'))
// The newsletter's staff side (review queue, digest, analytics) ships with
// the newsletter chunk.
const StaffNewsletterApp = lazy(() => import('../newsletter/StaffNewsletterApp'))
// Watches evals/runs seen RUNNING and toasts when they finish, from any area.
const JobWatcher = lazy(() => import('./manage/wikiAdmin/JobWatcher'))

// Which queue count each rail item shows (areas without a queue show none).
const AREA_QUEUE: Partial<Record<Area, QueueKind | 'total'>> = {
  review: 'total',
  newsletter: 'articles',
  corrections: 'corrections',
  apuntes: 'apuntes',
  wiki: 'wiki',
}

// Administración: one place for everything staff run, grouped by job in a
// side rail (the one exception to "one navigation bar per page", see
// docs/EDITORIAL_UI_SYSTEM.md §6). Its home, Para revisar, lists everything
// waiting on a decision. The area lives in the URL (/manage/:area).
export default function ManagePage() {
  const queue = useReviewQueue()
  const navigate = useNavigate()
  const watch = useJobWatch()
  const watching = activeJobs().length > 0 || watch.toasts.length > 0

  return (
    <ReviewQueueContext.Provider value={queue}>
      <main id="main-content" tabIndex={-1} className="outline-none container-content py-section-mobile lg:py-section">
        <Routes>
          <Route index element={<LegacyRedirect />} />
          <Route path=":area/*" element={<AreaLayout />} />
        </Routes>
        {watching && (
          <Suspense fallback={null}>
            <JobWatcher onOpen={() => navigate(areaPath('wiki'))} />
          </Suspense>
        )}
      </main>
    </ReviewQueueContext.Provider>
  )
}

// /manage → Para revisar; the old /manage?tab=drive links → their area.
function LegacyRedirect() {
  const [params] = useSearchParams()
  const legacy = LEGACY_TABS[params.get('tab') ?? '']
  return <Navigate to={areaPath(legacy ?? HOME_AREA)} replace />
}

function AreaLayout() {
  const { area } = useParams()
  const { t } = useTranslation()
  if (!isArea(area)) return <Navigate to={areaPath(HOME_AREA)} replace />
  const home = area === HOME_AREA

  return (
    <div className="flex flex-wrap items-start gap-x-10 gap-y-8">
      {/* On phones the rail is the home's list of areas, under the queue;
          inside an area it gives way to a link back. */}
      <div className={`${home ? 'order-2 md:order-none' : 'hidden md:block'} w-full md:w-auto md:flex-[1_1_220px] md:max-w-[250px]`}>
        <Rail current={area} />
      </div>
      <div className="flex-[999_1_560px] min-w-0">
        {!home && (
          <Link
            to={areaPath(HOME_AREA)}
            className="md:hidden inline-flex items-center gap-1.5 min-h-[44px] mb-2 font-mono text-label uppercase tracking-widest text-ink-secondary dark:text-night-muted hover:text-primary"
          >
            <span aria-hidden="true">←</span>
            {t('manage.rail.back')}
          </Link>
        )}
        <AreaContent area={area} />
      </div>
    </div>
  )
}

function Rail({ current }: { current: Area }) {
  const { t } = useTranslation()
  const { counts } = useQueue()
  const wikiUnseen = unseenCount()

  return (
    <nav aria-label={t('manage.rail.aria')} className="flex flex-col gap-6">
      <div className="hidden md:block">
        <p className="font-mono text-label uppercase tracking-widest text-ink-secondary dark:text-night-muted">{t('manage.rail.eyebrow')}</p>
        <p className="font-display font-bold text-h4 text-ink-primary dark:text-night-text">CEITBA</p>
      </div>
      <p className="md:hidden font-mono text-label uppercase tracking-widest text-ink-secondary dark:text-night-muted">{t('manage.rail.areas')}</p>
      {RAIL.map(({ group, areas }) => (
        <div key={group ?? 'home'} className={`flex flex-col gap-0.5 ${group == null ? 'hidden md:flex' : ''}`}>
          {group && (
            <p className="hidden md:block mb-1 font-mono text-label uppercase tracking-widest text-ink-secondary dark:text-night-muted">
              {t(`manage.rail.groups.${group}`)}
            </p>
          )}
          {areas.map((a) => {
            const kind = AREA_QUEUE[a]
            const count = kind ? counts[kind] : 0
            return (
              <NavLink
                key={a}
                to={areaPath(a)}
                aria-current={a === current ? 'page' : undefined}
                className={() => [
                  'flex items-center gap-2 min-h-[44px] px-3 rounded-sm font-body text-body-sm transition-colors duration-150',
                  a === current
                    ? 'bg-primary-50 dark:bg-night-raised text-primary dark:text-primary-300 font-bold'
                    : 'text-ink-primary dark:text-night-text hover:bg-primary-50 dark:hover:bg-night-raised',
                ].join(' ')}
              >
                <span className="flex-1">{t(`manage.areas.${a}.label`)}</span>
                {a === 'wiki' && wikiUnseen > 0 && (
                  <span className="w-2 h-2 rounded-full bg-accent" role="img" aria-label={t('manage.tabs.wikiAiUnseen', { count: wikiUnseen })} />
                )}
                {count > 0 && (
                  <span className="min-w-[24px] px-1.5 py-0.5 rounded-sm bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 font-mono text-label font-bold text-center">
                    <span className="sr-only">{t('manage.rail.pending', { count })}</span>
                    <span aria-hidden="true">{count}</span>
                  </span>
                )}
              </NavLink>
            )
          })}
        </div>
      ))}
    </nav>
  )
}

function AreaContent({ area }: { area: Area }) {
  const lazyFallback = <SkeletonTable rows={6} cols={4} />
  const navigate = useNavigate()

  switch (area) {
    case 'review':
      return <ManageReviewSection />
    case 'newsletter':
      return (
        <Suspense fallback={lazyFallback}>
          <StaffNewsletterApp />
        </Suspense>
      )
    case 'benefits':
      return <AreaFrame area={area} withSubtitle><ManageBenefitsSection /></AreaFrame>
    case 'people':
      return <AreaFrame area={area} withSubtitle><PeopleArea /></AreaFrame>
    case 'organizations':
      return (
        <AreaFrame area={area}>
          <ManageOrganizationsSection
            onAddMembers={(org: OrganizationSummary) => navigate(areaPath('people'), { state: { addingTo: org } })}
          />
        </AreaFrame>
      )
    case 'corrections':
      return <AreaFrame area={area}><ManageCorrectionsSection /></AreaFrame>
    case 'apuntes':
      return <AreaFrame area={area}><Suspense fallback={lazyFallback}><ManageDriveSection /></Suspense></AreaFrame>
    case 'wiki':
      return <AreaFrame area={area}><Suspense fallback={lazyFallback}><ManageWikiAiSection /></Suspense></AreaFrame>
    case 'capabilities':
      return <AreaFrame area={area}><ManageCapabilitiesSection /></AreaFrame>
  }
}

// "Agregar miembros" in Organizaciones opens Personas in "adding to <org>"
// mode; the org travels in the navigation state.
function PeopleArea() {
  const { state } = useLocation() as { state: { addingTo?: OrganizationSummary } | null }
  return <ManageUsersSection initialAddingTo={state?.addingTo} />
}

// The area's title. Sections that already open with their own intro don't
// get a subtitle on top of it.
function AreaFrame({ area, withSubtitle = false, children }: { area: Area; withSubtitle?: boolean; children: ReactNode }) {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="font-display font-bold text-h2 text-ink-primary dark:text-night-text">{t(`manage.areas.${area}.label`)}</h1>
        {withSubtitle && (
          <p className="font-body text-body text-ink-secondary dark:text-night-muted mt-1 max-w-2xl">{t(`manage.areas.${area}.subtitle`)}</p>
        )}
      </header>
      {children}
    </div>
  )
}
