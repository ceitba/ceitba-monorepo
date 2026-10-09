import { lazy, Suspense } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { I18nextProvider } from 'react-i18next'
import { SkeletonForm, SkeletonTable } from '@/components/ui'
import i18n from './i18nNewsletter'
import { REVIEW_PATH } from './paths'
import './newsletter.css'
import StaffAdminLayout from './layouts/StaffAdminLayout'
import AdminReviewPage from './pages/admin/AdminReviewPage'
import AdminAnalyticsPage from './pages/admin/AdminAnalyticsPage'
import { CONTRIBUTIONS_ENABLED } from './config/features'

// The article editor bundles TipTap; the digest pages are rarely visited.
const ArticleFormPage           = lazy(() => import('./pages/mine/ArticleFormPage'))
const AdminDigestsPage          = lazy(() => import('./pages/admin/AdminDigestsPage'))
const AdminDigestEditorPage     = lazy(() => import('./pages/admin/AdminDigestEditorPage'))
const AdminSuggestionsPage      = lazy(() => import('./pages/admin/AdminSuggestionsPage'))
const AdminSuggestionReviewPage = lazy(() => import('./pages/admin/AdminSuggestionReviewPage'))

// The staff side of the newsletter, mounted by the site's Administración at
// /manage/newsletter/* (already behind StaffGuard) and loaded with the
// newsletter chunk. Route paths are relative to /manage/newsletter; its
// strings live in the "newsletter" i18n namespace like the rest of it.
export default function StaffNewsletterApp() {
  const formFallback = <SkeletonForm fields={5} />
  const listFallback = <SkeletonTable rows={5} cols={4} />
  return (
    <I18nextProvider i18n={i18n} defaultNS="newsletter">
      <Routes>
        <Route element={<StaffAdminLayout />}>
          <Route index                        element={<Navigate to={REVIEW_PATH} replace />} />
          <Route path="review"                element={<AdminReviewPage />} />
          <Route path="review/:id"            element={<Suspense fallback={formFallback}><ArticleFormPage /></Suspense>} />
          <Route path="digests"               element={<Suspense fallback={listFallback}><AdminDigestsPage /></Suspense>} />
          <Route path="digests/:id"           element={<Suspense fallback={formFallback}><AdminDigestEditorPage /></Suspense>} />
          <Route path="analytics"             element={<AdminAnalyticsPage />} />
          {CONTRIBUTIONS_ENABLED && (
            <>
              <Route path="suggestions"           element={<Suspense fallback={listFallback}><AdminSuggestionsPage /></Suspense>} />
              <Route path="suggestions/:type/:id" element={<Suspense fallback={formFallback}><AdminSuggestionReviewPage /></Suspense>} />
            </>
          )}
          <Route path="*"                     element={<Navigate to={REVIEW_PATH} replace />} />
        </Route>
      </Routes>
    </I18nextProvider>
  )
}
