import { lazy, Suspense } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { I18nextProvider } from 'react-i18next'
import i18n from './i18nNewsletter'
import { newsletterPath } from './paths'
import './newsletter.css'
import PublicLayout from './layouts/PublicLayout'
import AdminLayout from './layouts/AdminLayout'
import AdminAuthGuard from './admin/AdminAuthGuard'
import { CONTRIBUTIONS_ENABLED } from './config/features'

import ArticlesPage        from './pages/ArticlesPage'
import ArticleDetailPage   from './pages/ArticleDetailPage'
import EventsPage          from './pages/EventsPage'
import OrganizationsPage   from './pages/OrganizationsPage'
import OrgPortalPage       from './pages/OrgPortalPage'

import AdminLoginPage             from './pages/admin/AdminLoginPage'
import AdminArticlesPage          from './pages/admin/AdminArticlesPage'
import AdminEventsPage            from './pages/admin/AdminEventsPage'
import AdminEventFormPage         from './pages/admin/AdminEventFormPage'
import AdminAnalyticsPage         from './pages/admin/AdminAnalyticsPage'
import AdminOrganizationProfilePage   from './pages/admin/AdminOrganizationProfilePage'
import AdminOrganizationFollowersPage from './pages/admin/AdminOrganizationFollowersPage'
import AdminOrganizationsListPage     from './pages/admin/AdminOrganizationsListPage'
import UnsubscribePage                from './pages/UnsubscribePage'
import CorrectionVotePage             from './pages/CorrectionVotePage'

// Contributor workflow — still backed by localStorage mocks, so it is hidden
// behind CONTRIBUTIONS_ENABLED (see config/features.js). Lazy so the mock
// stores are never loaded while the flag is off.
const ContributorLayout             = lazy(() => import('./layouts/ContributorLayout'))
const ContributorAuthGuard          = lazy(() => import('./admin/ContributorAuthGuard'))
// The article editor bundles TipTap; keep it out of the public chunk.
const AdminArticleFormPage          = lazy(() => import('./pages/admin/AdminArticleFormPage'))
// Weekly digest admin (STAFF only) — rarely visited, keep it lazy.
const AdminDigestsPage              = lazy(() => import('./pages/admin/AdminDigestsPage'))
const AdminDigestEditorPage         = lazy(() => import('./pages/admin/AdminDigestEditorPage'))
const AdminSuggestionsPage          = lazy(() => import('./pages/admin/AdminSuggestionsPage'))
const AdminSuggestionReviewPage     = lazy(() => import('./pages/admin/AdminSuggestionReviewPage'))
const ContributorSuggestionsPage    = lazy(() => import('./pages/contributor/ContributorSuggestionsPage'))
const ContributorSuggestArticlePage = lazy(() => import('./pages/contributor/ContributorSuggestArticlePage'))
const ContributorSuggestEventPage   = lazy(() => import('./pages/contributor/ContributorSuggestEventPage'))
const ContributorReviewChangesPage  = lazy(() => import('./pages/contributor/ContributorReviewChangesPage'))

// The student newsletter, mounted at /newsletter/* by App.tsx and loaded on
// demand. Route paths here are relative to /newsletter; its strings live in
// the "newsletter" i18n namespace, and the .newsletter-scope wrapper scopes
// its dark-mode overrides (newsletter.css).
export default function NewsletterApp() {
  return (
    <I18nextProvider i18n={i18n} defaultNS="newsletter">
      <div className="newsletter-scope">
        <Routes>
          {/* ── Admin ─────────────────────────────────────── */}
          <Route path="admin/login"    element={<AdminLoginPage />} />

          <Route
            path="admin"
            element={
              <AdminAuthGuard>
                <AdminLayout />
              </AdminAuthGuard>
            }
          >
            <Route index element={<Navigate to="articles" replace />} />
            <Route path="articles"                       element={<AdminArticlesPage />} />
            <Route path="articles/new"                   element={<Suspense fallback={null}><AdminArticleFormPage /></Suspense>} />
            <Route path="articles/:id/edit"              element={<Suspense fallback={null}><AdminArticleFormPage /></Suspense>} />
            <Route path="events"                         element={<AdminEventsPage />} />
            <Route path="events/new"                     element={<AdminEventFormPage />} />
            <Route path="events/:id/edit"                element={<AdminEventFormPage />} />
            <Route path="analytics"                      element={<AdminAnalyticsPage />} />
            <Route path="digests"                        element={<Suspense fallback={null}><AdminDigestsPage /></Suspense>} />
            <Route path="digests/:id"                    element={<Suspense fallback={null}><AdminDigestEditorPage /></Suspense>} />
            {CONTRIBUTIONS_ENABLED ? (
              <>
                <Route path="suggestions"                element={<Suspense fallback={null}><AdminSuggestionsPage /></Suspense>} />
                <Route path="suggestions/:type/:id"      element={<Suspense fallback={null}><AdminSuggestionReviewPage /></Suspense>} />
              </>
            ) : (
              <Route path="suggestions/*"                element={<Navigate to={newsletterPath('/admin/articles')} replace />} />
            )}
            <Route path="org/:slug"                      element={<AdminOrganizationProfilePage />} />
            <Route path="org/:slug/followers"            element={<AdminOrganizationFollowersPage />} />
            <Route path="organizations"                  element={<AdminOrganizationsListPage />} />
          </Route>

          {/* ── Contributor portal ────────────────────────── */}
          {CONTRIBUTIONS_ENABLED ? (
            <Route
              path="contribute"
              element={
                <Suspense fallback={null}>
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
        </Routes>
      </div>
    </I18nextProvider>
  )
}
