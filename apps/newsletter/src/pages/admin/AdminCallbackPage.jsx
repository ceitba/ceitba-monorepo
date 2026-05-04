import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { handleCallback, getSession } from '../../store/authStore'

export default function AdminCallbackPage() {
  const navigate = useNavigate()

  useEffect(() => {
    handleCallback().then(async (ok) => {
      if (!ok) { navigate('/admin/login', { replace: true }); return }
      const profile = await getSession()
      const adminRoles = ['staff', 'admin', 'editor']
      const hasAccess = profile && (
        adminRoles.includes(profile.role) ||
        (profile.organizations && profile.organizations.length > 0)
      )
      if (hasAccess) {
        navigate('/admin/articles', { replace: true })
      } else {
        navigate('/contribute', { replace: true })
      }
    })
  }, [navigate])

  return (
    <div className="min-h-screen bg-primary-900 flex items-center justify-center">
      <p className="text-white font-mono text-label uppercase tracking-widest">
        Verificando sesión…
      </p>
    </div>
  )
}
