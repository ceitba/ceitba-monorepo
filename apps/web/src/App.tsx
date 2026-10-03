import { lazy, Suspense, useEffect } from 'react'
import './i18n'
import { BrowserRouter, Routes, Route, Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { ThemeProvider } from './context/ThemeContext'
import Navbar from './components/Navbar'
import Footer from './components/Footer'
import HomePage from './pages/HomePage'
import ManagePage from './pages/ManagePage'
import ProfilePage from './pages/ProfilePage'
import StaffGuard from './components/StaffGuard'
import AuthGuard from './components/AuthGuard'
import PageFallback from './components/PageFallback'
import AuthErrorBanner from './components/AuthErrorBanner'
import { getSession, takeReturnTo } from './store/authStore'
import { isSafeReturnPath } from './utils/apuntes'

// Apuntes pages (and what they pull in: DOMPurify, the viewers, the wiki)
// load on demand so the home page bundle stays lean.
const ApuntesHomePage = lazy(() => import('./pages/apuntes/ApuntesHomePage'))
const SubjectFilesPage = lazy(() => import('./pages/apuntes/SubjectFilesPage'))
const FilePage = lazy(() => import('./pages/apuntes/FilePage'))
const MyApuntesPage = lazy(() => import('./pages/apuntes/MyApuntesPage'))
const WikiPage = lazy(() => import('./pages/apuntes/WikiPage'))
const WikiGraphPage = lazy(() => import('./pages/apuntes/WikiGraphPage'))
const WikiMapPage = lazy(() => import('./pages/apuntes/WikiMapPage'))

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

function Layout() {
  // Hydrate the session once at boot so the navbar and any guards have
  // data after the first /me round-trip resolves.
  useEffect(() => { getSession() }, [])

  return (
    <div className="flex flex-col min-h-screen bg-page-bg">
      <Navbar />
      <AuthErrorBanner />
      <div className="flex-1">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/auth/callback" element={<AuthCallback />} />
          <Route path="/manage" element={<StaffGuard><ManagePage /></StaffGuard>} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/apuntes" element={<AuthGuard><Suspense fallback={<PageFallback />}><ApuntesHomePage /></Suspense></AuthGuard>} />
          <Route path="/apuntes/mis-apuntes" element={<AuthGuard><Suspense fallback={<PageFallback />}><MyApuntesPage /></Suspense></AuthGuard>} />
          <Route path="/apuntes/mapa" element={<AuthGuard><Suspense fallback={<PageFallback />}><WikiMapPage /></Suspense></AuthGuard>} />
          <Route path="/apuntes/archivo/:fileId" element={<AuthGuard><Suspense fallback={<PageFallback />}><FilePage /></Suspense></AuthGuard>} />
          <Route path="/apuntes/:subjectId" element={<AuthGuard><Suspense fallback={<PageFallback />}><SubjectFilesPage /></Suspense></AuthGuard>} />
          <Route path="/apuntes/:subjectId/wiki/:slug" element={<AuthGuard><Suspense fallback={<PageFallback />}><WikiPage /></Suspense></AuthGuard>} />
          <Route path="/apuntes/:subjectId/grafo" element={<AuthGuard><Suspense fallback={<PageFallback />}><WikiGraphPage /></Suspense></AuthGuard>} />
          {DevLoginPage && (
            <Route path="/dev-login" element={<Suspense fallback={null}><DevLoginPage /></Suspense>} />
          )}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
      <Footer />
    </div>
  )
}

export default function App() {
  return (
    <ThemeProvider>
      <BrowserRouter basename={import.meta.env.BASE_URL}>
        <Layout />
      </BrowserRouter>
    </ThemeProvider>
  )
}
