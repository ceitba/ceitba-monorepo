import { useEffect } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { getSession } from './store/authStore'
import PublicLayout from './layouts/PublicLayout'
import AdminLayout from './layouts/AdminLayout'
import ContributorLayout from './layouts/ContributorLayout'
import AdminAuthGuard from './admin/AdminAuthGuard'
import ContributorAuthGuard from './admin/ContributorAuthGuard'

import ArticlesPage        from './pages/ArticlesPage'
import ArticleDetailPage   from './pages/ArticleDetailPage'
import EventsPage          from './pages/EventsPage'
import OrganizationsPage   from './pages/OrganizationsPage'
import OrgPortalPage       from './pages/OrgPortalPage'

import AdminLoginPage             from './pages/admin/AdminLoginPage'
import AdminCallbackPage          from './pages/admin/AdminCallbackPage'
import AdminArticlesPage          from './pages/admin/AdminArticlesPage'
import AdminArticleFormPage       from './pages/admin/AdminArticleFormPage'
import AdminEventsPage            from './pages/admin/AdminEventsPage'
import AdminEventFormPage         from './pages/admin/AdminEventFormPage'
import AdminAnalyticsPage         from './pages/admin/AdminAnalyticsPage'
import AdminSuggestionsPage       from './pages/admin/AdminSuggestionsPage'
import AdminSuggestionReviewPage  from './pages/admin/AdminSuggestionReviewPage'
import AdminOrganizationProfilePage from './pages/admin/AdminOrganizationProfilePage'
import AdminOrganizationsListPage   from './pages/admin/AdminOrganizationsListPage'

import ContributorSuggestionsPage    from './pages/contributor/ContributorSuggestionsPage'
import ContributorSuggestArticlePage from './pages/contributor/ContributorSuggestArticlePage'
import ContributorSuggestEventPage   from './pages/contributor/ContributorSuggestEventPage'
import ContributorReviewChangesPage  from './pages/contributor/ContributorReviewChangesPage'

export default function App() {
  // Hydrate the session once at boot so synchronous reads (Navbar avatar,
  // isStaff(), etc.) have data after the first /me round-trip resolves.
  useEffect(() => { getSession() }, [])

  return (
    <Routes>
      {/* ── Admin ─────────────────────────────────────── */}
      <Route path="/admin/login"    element={<AdminLoginPage />} />
      <Route path="/admin/callback" element={<AdminCallbackPage />} />

      <Route
        path="/admin"
        element={
          <AdminAuthGuard>
            <AdminLayout />
          </AdminAuthGuard>
        }
      >
        <Route index element={<Navigate to="articles" replace />} />
        <Route path="articles"                       element={<AdminArticlesPage />} />
        <Route path="articles/new"                   element={<AdminArticleFormPage />} />
        <Route path="articles/:id/edit"              element={<AdminArticleFormPage />} />
        <Route path="events"                         element={<AdminEventsPage />} />
        <Route path="events/new"                     element={<AdminEventFormPage />} />
        <Route path="events/:id/edit"                element={<AdminEventFormPage />} />
        <Route path="analytics"                      element={<AdminAnalyticsPage />} />
        <Route path="suggestions"                    element={<AdminSuggestionsPage />} />
        <Route path="suggestions/:type/:id"          element={<AdminSuggestionReviewPage />} />
        <Route path="org/:slug"                      element={<AdminOrganizationProfilePage />} />
        <Route path="organizations"                  element={<AdminOrganizationsListPage />} />
      </Route>

      {/* ── Contributor portal ────────────────────────── */}
      <Route
        path="/contribute"
        element={
          <ContributorAuthGuard>
            <ContributorLayout />
          </ContributorAuthGuard>
        }
      >
        <Route index                                    element={<ContributorSuggestionsPage />} />
        <Route path="suggest/article"                   element={<ContributorSuggestArticlePage />} />
        <Route path="suggest/article/:id/edit"          element={<ContributorSuggestArticlePage />} />
        <Route path="suggest/event"                     element={<ContributorSuggestEventPage />} />
        <Route path="suggest/event/:id/edit"            element={<ContributorSuggestEventPage />} />
        <Route path="review/:type/:id"                  element={<ContributorReviewChangesPage />} />
      </Route>

      {/* ── Public ────────────────────────────────────── */}
      <Route element={<PublicLayout />}>
        <Route path="/"                    element={<ArticlesPage />} />
        <Route path="/articles/:id"        element={<ArticleDetailPage />} />
        <Route path="/events"              element={<EventsPage />} />
        <Route path="/organizations"       element={<OrganizationsPage />} />
        <Route path="/organizations/:slug" element={<OrgPortalPage />} />
        <Route path="*"                    element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
