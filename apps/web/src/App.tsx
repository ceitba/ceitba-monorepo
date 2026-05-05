import { useEffect } from 'react'
import './i18n'
import { BrowserRouter, Routes, Route, Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { ThemeProvider } from './context/ThemeContext'
import Navbar from './components/Navbar'
import Footer from './components/Footer'
import HomePage from './pages/HomePage'
import ManagePage from './pages/ManagePage'
import ProfilePage from './pages/ProfilePage'
import StaffGuard from './components/StaffGuard'
import { getSession } from './store/authStore'

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
    getSession({ force: true }).finally(() => navigate('/', { replace: true }))
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
      <div className="flex-1">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/auth/callback" element={<AuthCallback />} />
          <Route path="/manage" element={<StaffGuard><ManagePage /></StaffGuard>} />
          <Route path="/profile" element={<ProfilePage />} />
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
