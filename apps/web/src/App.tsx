import { lazy, Suspense, useEffect } from 'react'
import './i18n'
import { createBrowserRouter, RouterProvider, Routes, Route, Navigate, matchPath, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ThemeProvider } from './context/ThemeContext'
import Navbar from './components/Navbar'
import Footer from './components/Footer'
import HomePage from './pages/HomePage'
import BenefitsPage from './pages/BenefitsPage'
import ProfilePage from './pages/ProfilePage'
import StaffGuard from './components/StaffGuard'
import CapabilityGuard from './components/CapabilityGuard'
import PageFallback from './components/PageFallback'
import AuthErrorBanner from './components/AuthErrorBanner'
import { Toaster } from './components/ui/Toaster'
import { ErrorState } from './components/ui'
import { getSession, isSafeReturnPath, takeReturnTo } from './store/authStore'

// Apuntes pages (and what they pull in: DOMPurify, the viewers, the wiki)
// load on demand so the home page bundle stays lean.
const ApuntesHomePage = lazy(() => import('./pages/apuntes/ApuntesHomePage'))
const SubjectFilesPage = lazy(() => import('./pages/apuntes/SubjectFilesPage'))
const FilePage = lazy(() => import('./pages/apuntes/FilePage'))
const MyApuntesPage = lazy(() => import('./pages/apuntes/MyApuntesPage'))
const WikiPage = lazy(() => import('./pages/apuntes/WikiPage'))
const WikiGraphPage = lazy(() => import('./pages/apuntes/WikiGraphPage'))
const CorrelativasPage = lazy(() => import('./pages/apuntes/CorrelativasPage'))

// Sections that used to be separate SPAs, each in its own chunk.
// Administración (staff only): its own chunk, with the queue and its areas.
const ManagePage = lazy(() => import('./pages/ManagePage'))
const SchedulerApp = lazy(() => import('./scheduler/SchedulerApp'))
const NewsletterApp = lazy(() => import('./newsletter/NewsletterApp'))

// Local dev-only sign-in (CEITBA-API POST /v1/auth/dev-login). Both env
// checks are inlined so Vite folds them to `false` in production builds and
// Rollup drops the lazy import (the page is not emitted at all).
const DevLoginPage = import.meta.env.DEV && import.meta.env.VITE_DEV_LOGIN === 'true'
  ? lazy(() => import('./pages/DevLoginPage'))
  : null

// Lands here after the API redirects post-OAuth. The session cookie is
// already set by the time we get here; we just need to refresh the cache
// and bounce to home (or surface an error).
function AuthCallback() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  useEffect(() => {
    const error = params.get('error')
    if (error) {
      navigate(`/?authError=${encodeURIComponent(error)}`, { replace: true })
      return
    }
    // Pages behind AuthGuard stash where to come back to before leaving
    // for Google.
    const returnTo = takeReturnTo()
    getSession({ force: true }).finally(() =>
      navigate(isSafeReturnPath(returnTo) ? returnTo : '/', { replace: true }))
  }, [navigate, params])
  return null
}

// Pages with their own full-screen chrome instead of the app's Navbar and
// Footer: the newsletter's contributor portal (behind a feature flag). The
// newsletter admin renders inside the site chrome, like /manage.
const CHROMELESS = ['/newsletter/contribute/*']

function Layout() {
  const { pathname } = useLocation()
  if (CHROMELESS.some((pattern) => matchPath(pattern, pathname))) {
    return (
      <Routes>
        <Route path="/newsletter/*" element={<Suspense fallback={<PageFallback />}><NewsletterApp /></Suspense>} />
      </Routes>
    )
  }

  return (
    <div className="flex flex-col min-h-screen bg-page-bg">
      <Navbar />
      <AuthErrorBanner />
      <div className="flex-1">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/benefits" element={<BenefitsPage />} />
          <Route path="/manage/*" element={<StaffGuard><Suspense fallback={<PageFallback />}><ManagePage /></Suspense></StaffGuard>} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/apuntes" element={<CapabilityGuard capability="apuntes"><Suspense fallback={<PageFallback />}><ApuntesHomePage /></Suspense></CapabilityGuard>} />
          <Route path="/apuntes/mis-apuntes" element={<CapabilityGuard capability="apuntes"><Suspense fallback={<PageFallback />}><MyApuntesPage /></Suspense></CapabilityGuard>} />
          <Route path="/apuntes/correlativas" element={<CapabilityGuard capability="apuntes"><Suspense fallback={<PageFallback />}><CorrelativasPage /></Suspense></CapabilityGuard>} />
          <Route path="/apuntes/archivo/:fileId" element={<CapabilityGuard capability="apuntes"><Suspense fallback={<PageFallback />}><FilePage /></Suspense></CapabilityGuard>} />
          <Route path="/apuntes/:subjectId" element={<CapabilityGuard capability="apuntes"><Suspense fallback={<PageFallback />}><SubjectFilesPage /></Suspense></CapabilityGuard>} />
          <Route path="/apuntes/:subjectId/wiki/:slug" element={<CapabilityGuard capability="apuntes"><Suspense fallback={<PageFallback />}><WikiPage /></Suspense></CapabilityGuard>} />
          <Route path="/apuntes/:subjectId/grafo" element={<CapabilityGuard capability="apuntes"><Suspense fallback={<PageFallback />}><WikiGraphPage /></Suspense></CapabilityGuard>} />
          <Route path="/scheduler/*" element={<Suspense fallback={<PageFallback />}><SchedulerApp /></Suspense>} />
          <Route path="/newsletter/*" element={<Suspense fallback={<PageFallback />}><NewsletterApp /></Suspense>} />
          {DevLoginPage && (
            <Route path="/dev-login" element={<Suspense fallback={null}><DevLoginPage /></Suspense>} />
          )}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
      <Footer />
      <Toaster />
    </div>
  )
}

function Root() {
  // Hydrate the session once at boot so the navbar and any guards have
  // data after the first /me round-trip resolves.
  useEffect(() => { getSession() }, [])

  return (
    <Routes>
      <Route path="/auth/callback" element={<AuthCallback />} />
      {/* OAuth redirect URIs of the old standalone scheduler and newsletter;
          sign-ins started before the merge can still land there. */}
      <Route path="/scheduler/auth/callback" element={<AuthCallback />} />
      <Route path="/newsletter/admin/callback" element={<AuthCallback />} />
      <Route path="/*" element={<Layout />} />
    </Routes>
  )
}

// A data router (rather than BrowserRouter) so pages can use useBlocker: the
// newsletter's article editor asks before any in-app navigation, back/forward
// included, drops unsaved changes. Routes are still declared with <Routes>,
// rendered under one catch-all route.
const router = createBrowserRouter(
  [{ path: '*', element: <Root />, errorElement: <RouteError /> }],
  { basename: import.meta.env.BASE_URL },
)

// Anything that escapes a page (e.g. a lazy page whose chunk is gone after a
// deploy and the one automatic reload in main.tsx didn't fix) lands here
// instead of React Router's developer screen.
function RouteError() {
  const { t } = useTranslation()
  return (
    <main id="main-content" className="container-content py-section-mobile lg:py-section">
      <ErrorState message={t('errors.pageFailed')} onRetry={() => window.location.reload()} />
    </main>
  )
}

export default function App() {
  return (
    <ThemeProvider>
      <RouterProvider router={router} />
    </ThemeProvider>
  )
}
