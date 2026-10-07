import { lazy, Suspense } from 'react'
import { Routes, Route, Navigate, Outlet, useLocation } from 'react-router-dom'
import { I18nextProvider } from 'react-i18next'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import PageFallback from '@/components/PageFallback'
import i18n from './i18nNewsletter'
import { MY_ARTICLES_PATH, REVIEW_PATH, newsletterPath } from './paths'
import './newsletter.css'
import PublicLayout from './layouts/PublicLayout'
import WriterLayout from './layouts/WriterLayout'
import StaffAdminLayout from './layouts/StaffAdminLayout'
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
import AdminReviewPage     from './pages/admin/AdminReviewPage'
import AdminAnalyticsPage  from './pages/admin/AdminAnalyticsPage'
import UnsubscribePage     from './pages/UnsubscribePage'
import CorrectionVotePage  from './pages/CorrectionVotePage'

// Contributor workflow — still backed by localStorage mocks, so it is hidden
// behind CONTRIBUTIONS_ENABLED (see config/features.js). Lazy so the mock
// stores are never loaded while the flag is off.
const ContributorLayout             = lazy(() => import('./layouts/ContributorLayout'))
const ContributorAuthGuard          = lazy(() => import('./admin/ContributorAuthGuard'))
// The article editor bundles TipTap; keep it out of the public chunk.
const ArticleFormPage               = lazy(() => import('./pages/mine/ArticleFormPage'))
// Weekly digest admin (STAFF only) — rarely visited, keep it lazy.
const AdminDigestsPage              = lazy(() => import('./pages/admin/AdminDigestsPage'))
const AdminDigestEditorPage         = lazy(() => import('./pages/admin/AdminDigestEditorPage'))
const AdminSuggestionsPage          = lazy(() => import('./pages/admin/AdminSuggestionsPage'))
const AdminSuggestionReviewPage     = lazy(() => import('./pages/admin/AdminSuggestionReviewPage'))
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

        {/* ── Admin (staff) ───────────────────────────────── */}
        {/* The old admin sign-in page: sign-in now happens in place. */}
        <Route path="admin/login"    element={<Navigate to={newsletterPath('/admin')} replace />} />
        <Route path="admin/articles/*" element={<RedirectToMine />} />
        <Route path="admin/events/*"   element={<RedirectToMine />} />
        <Route path="admin/org/*"      element={<RedirectToMine />} />

        <Route
          path="admin"
          element={
            <AreaAuthGuard staffOnly>
              <StaffAdminLayout />
            </AreaAuthGuard>
          }
        >
          <Route index                                 element={<Navigate to={REVIEW_PATH} replace />} />
          <Route path="review"                         element={<AdminReviewPage />} />
          <Route path="review/:id"                     element={editor} />
          <Route path="digests"                        element={<Suspense fallback={<PageFallback />}><AdminDigestsPage /></Suspense>} />
          <Route path="digests/:id"                    element={<Suspense fallback={<PageFallback />}><AdminDigestEditorPage /></Suspense>} />
          <Route path="analytics"                      element={<AdminAnalyticsPage />} />
          {CONTRIBUTIONS_ENABLED && (
            <>
              <Route path="suggestions"                element={<Suspense fallback={<PageFallback />}><AdminSuggestionsPage /></Suspense>} />
              <Route path="suggestions/:type/:id"      element={<Suspense fallback={<PageFallback />}><AdminSuggestionReviewPage /></Suspense>} />
            </>
          )}
          {/* The staff list of every organization lives in /manage. */}
          <Route path="organizations"                  element={<Navigate to="/manage" replace />} />
          <Route path="*"                              element={<Navigate to={REVIEW_PATH} replace />} />
        </Route>

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
