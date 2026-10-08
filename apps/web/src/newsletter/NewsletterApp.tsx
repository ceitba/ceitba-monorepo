import { lazy, Suspense } from 'react'
import { Routes, Route, Navigate, Outlet, useLocation } from 'react-router-dom'
import { I18nextProvider } from 'react-i18next'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import PageFallback from '@/components/PageFallback'
import { useAuth } from '@/hooks/useAuth'
import { areaPath } from '@/pages/manage/areas'
import i18n from './i18nNewsletter'
import { ADMIN_PATH, MY_ARTICLES_PATH, newsletterPath } from './paths'
import './newsletter.css'
import PublicLayout from './layouts/PublicLayout'
import WriterLayout from './layouts/WriterLayout'
import AreaAuthGuard from './admin/AreaAuthGuard'
import { CONTRIBUTIONS_ENABLED } from './config/features'

import ArticlesPage        from './pages/ArticlesPage'
import ArticleDetailPage   from './pages/ArticleDetailPage'
import EventsPage          from './pages/EventsPage'
import OrganizationsPage   from './pages/OrganizationsPage'
import OrgPortalPage       from './pages/OrgPortalPage'

import MyArticlesPage      from './pages/mine/MyArticlesPage'
import MyEventsPage        from './pages/mine/MyEventsPage'
import EventFormPage       from './pages/mine/EventFormPage'
import OrgProfilePage      from './pages/mine/OrgProfilePage'
import OrgFollowersPage    from './pages/mine/OrgFollowersPage'
import UnsubscribePage     from './pages/UnsubscribePage'
import CorrectionVotePage  from './pages/CorrectionVotePage'

// Contributor workflow — still backed by localStorage mocks, so it is hidden
// behind CONTRIBUTIONS_ENABLED (see config/features.js). Lazy so the mock
// stores are never loaded while the flag is off.
const ContributorLayout             = lazy(() => import('./layouts/ContributorLayout'))
const ContributorAuthGuard          = lazy(() => import('./admin/ContributorAuthGuard'))
// The article editor bundles TipTap; keep it out of the public chunk.
const ArticleFormPage               = lazy(() => import('./pages/mine/ArticleFormPage'))
const ContributorSuggestionsPage    = lazy(() => import('./pages/contributor/ContributorSuggestionsPage'))
const ContributorSuggestArticlePage = lazy(() => import('./pages/contributor/ContributorSuggestArticlePage'))
const ContributorSuggestEventPage   = lazy(() => import('./pages/contributor/ContributorSuggestEventPage'))
const ContributorReviewChangesPage  = lazy(() => import('./pages/contributor/ContributorReviewChangesPage'))

const editor = <Suspense fallback={<PageFallback />}><ArticleFormPage /></Suspense>

// Writing, events and org profiles used to live under /admin, open to every
// signed-in user; they moved to /mine. Old links (bookmarks, /manage, emails)
// land on the same page there, whoever follows them.
function RedirectToMine() {
  const { pathname, search } = useLocation()
  return <Navigate to={pathname.replace(newsletterPath('/admin/'), newsletterPath('/mine/')) + search} replace />
}

// The staff admin (review queue, weekly digest, analytics) moved into the
// site's Administración, at /manage/newsletter. Old links, including the
// Google mail-consent redirect back to /admin/digests?mail=…, keep working
// for staff. Everyone else who followed an old /admin link (a bookmark, or a
// sign-in started before the move, whose return path was /admin) was a
// writer: they land on Mis publicaciones, not on a staff-only page.
function RedirectToManage() {
  const { pathname, search } = useLocation()
  const { loading, isStaff } = useAuth()
  if (loading) return <PageFallback />
  if (!isStaff) return <Navigate to={MY_ARTICLES_PATH} replace />
  const rest = pathname.slice(newsletterPath('/admin').length)
  if (rest === '/organizations' || rest.startsWith('/organizations/')) return <Navigate to={areaPath('organizations')} replace />
  return <Navigate to={ADMIN_PATH + (rest === '/login' ? '' : rest) + search} replace />
}

// The student newsletter, mounted at /newsletter/* by App.tsx and loaded on
// demand. Route paths here are relative to /newsletter; its strings live in
// the "newsletter" i18n namespace.
export default function NewsletterApp() {
  useDocumentTitle('ITBA News | CEITBA')
  return (
    <I18nextProvider i18n={i18n} defaultNS="newsletter">
      <Routes>
        {/* ── Mis publicaciones (anyone signed in) ─────── */}
        <Route
          path="mine"
          element={
            <AreaAuthGuard>
              <WriterLayout />
            </AreaAuthGuard>
          }
        >
          <Route index                       element={<Navigate to={MY_ARTICLES_PATH} replace />} />
          <Route path="articles"             element={<MyArticlesPage />} />
          <Route path="articles/new"         element={editor} />
          <Route path="articles/:id/edit"    element={editor} />
          <Route path="events"               element={<MyEventsPage />} />
          <Route path="events/new"           element={<EventFormPage />} />
          <Route path="events/:id/edit"      element={<EventFormPage />} />
          <Route path="org/:slug"            element={<OrgProfilePage />} />
          <Route path="org/:slug/followers"  element={<OrgFollowersPage />} />
          <Route path="*"                    element={<Navigate to={MY_ARTICLES_PATH} replace />} />
        </Route>

        {/* ── Old /admin links ─────────────────────────────── */}
        <Route path="admin/articles/*" element={<RedirectToMine />} />
        <Route path="admin/events/*"   element={<RedirectToMine />} />
        <Route path="admin/org/*"      element={<RedirectToMine />} />
        <Route path="admin/*"          element={<RedirectToManage />} />

        <Route element={<Outlet />}>
          {/* ── Contributor portal ────────────────────────── */}
          {CONTRIBUTIONS_ENABLED ? (
            <Route
              path="contribute"
              element={
                <Suspense fallback={<PageFallback />}>
                  <ContributorAuthGuard>
                    <ContributorLayout />
                  </ContributorAuthGuard>
                </Suspense>
              }
            >
              <Route index                                  element={<ContributorSuggestionsPage />} />
              <Route path="suggest/article"                 element={<ContributorSuggestArticlePage />} />
              <Route path="suggest/article/:id/edit"        element={<ContributorSuggestArticlePage />} />
              <Route path="suggest/event"                   element={<ContributorSuggestEventPage />} />
              <Route path="suggest/event/:id/edit"          element={<ContributorSuggestEventPage />} />
              <Route path="review/:type/:id"                element={<ContributorReviewChangesPage />} />
            </Route>
          ) : (
            <Route path="contribute/*" element={<Navigate to={newsletterPath('/')} replace />} />
          )}

          {/* ── Public ────────────────────────────────────── */}
          <Route element={<PublicLayout />}>
            <Route index                        element={<ArticlesPage />} />
            <Route path="articles/:id"        element={<ArticleDetailPage />} />
            <Route path="events"              element={<EventsPage />} />
            <Route path="organizations"       element={<OrganizationsPage />} />
            <Route path="organizations/:slug" element={<OrgPortalPage />} />
            {/* One-click unsubscribe link from the weekly digest email. */}
            <Route path="unsubscribe"         element={<UnsubscribePage />} />
            {/* "Sí, es así" / "No" schedule-correction links of the digest. */}
            <Route path="correction"          element={<CorrectionVotePage />} />
            <Route path="*"                    element={<Navigate to={newsletterPath('/')} replace />} />
          </Route>
        </Route>
      </Routes>
    </I18nextProvider>
  )
}
