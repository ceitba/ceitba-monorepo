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
import ApuntesHomePage from './pages/apuntes/ApuntesHomePage'
import SubjectFilesPage from './pages/apuntes/SubjectFilesPage'
import FilePage from './pages/apuntes/FilePage'
import MyApuntesPage from './pages/apuntes/MyApuntesPage'
import WikiPage from './pages/apuntes/WikiPage'
import AuthErrorBanner from './components/AuthErrorBanner'
import { getSession, takeReturnTo } from './store/authStore'
import { isSafeReturnPath } from './utils/apuntes'

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
          <Route path="/apuntes" element={<AuthGuard><ApuntesHomePage /></AuthGuard>} />
          <Route path="/apuntes/mis-apuntes" element={<AuthGuard><MyApuntesPage /></AuthGuard>} />
          <Route path="/apuntes/archivo/:fileId" element={<AuthGuard><FilePage /></AuthGuard>} />
          <Route path="/apuntes/:subjectId" element={<AuthGuard><SubjectFilesPage /></AuthGuard>} />
          <Route path="/apuntes/:subjectId/wiki/:slug" element={<AuthGuard><WikiPage /></AuthGuard>} />
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
