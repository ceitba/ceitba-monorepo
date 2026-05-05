import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  addUserOrganization,
  assignStaff,
  fetchOrganizations,
  fetchUsers,
  removeUserOrganization,
  revokeStaff,
  type AdminUser,
  type OrganizationSummary,
} from '../../api/admin'

const STAFF_BRANCH = 'DIRECTIVES'
const STAFF_ROLE = 'MEMBER'

// One year is the default tenure; staff can re-assign with a custom range
// directly via /v1/staff if they need precision.
function defaultStaffRange() {
  const start = new Date()
  const end = new Date()
  end.setFullYear(start.getFullYear() + 1)
  return { start: start.toISOString(), end: end.toISOString() }
}

export default function ManageUsersSection() {
  const { t } = useTranslation()
  const [users, setUsers] = useState<AdminUser[]>([])
  const [orgs, setOrgs] = useState<OrganizationSummary[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  useEffect(() => {
    fetchUsers().then(setUsers).catch((e: Error) => setError(e.message))
    fetchOrganizations().then(setOrgs).catch(() => setOrgs([]))
  }, [])

  function reload() {
    fetchUsers().then(setUsers).catch((e: Error) => setError(e.message))
  }

  async function toggleStaff(u: AdminUser) {
    setError(null); setBusyId(u.id)
    try {
      if (u.isStaff) await revokeStaff(u.id)
      else await assignStaff({ email: u.email, branch: STAFF_BRANCH, role: STAFF_ROLE, ...defaultStaffRange() })
      reload()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusyId(null)
    }
  }

  async function addOrg(u: AdminUser, slug: string) {
    if (!slug) return
    setError(null); setBusyId(u.id)
    try {
      await addUserOrganization(u.id, slug, 'member')
      reload()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusyId(null)
    }
  }

  async function removeOrg(u: AdminUser, slug: string) {
    setError(null); setBusyId(u.id)
    try {
      await removeUserOrganization(u.id, slug)
      reload()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {error && <p className="px-3 py-2 rounded-sm bg-red-50 text-red-700 font-body text-body-sm border border-red-200">{error}</p>}

      <div className="overflow-x-auto rounded-card border border-border dark:border-[#3f3f46]">
        <table className="w-full font-body text-body-sm">
          <thead className="bg-page-bg dark:bg-[#18181b]">
            <tr className="text-left">
              <th className="px-3 py-2 font-mono text-label uppercase tracking-widest">{t('manage.users.col.user')}</th>
              <th className="px-3 py-2 font-mono text-label uppercase tracking-widest">{t('manage.users.col.staff')}</th>
              <th className="px-3 py-2 font-mono text-label uppercase tracking-widest">{t('manage.users.col.organizations')}</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => {
              const orgOptions = orgs.filter((o) => !u.organizations.find((m) => m.slug === o.slug))
              return (
                <tr key={u.id} className="border-t border-border dark:border-[#3f3f46] align-top">
                  <td className="px-3 py-3">
                    <p className="font-semibold text-ink-primary dark:text-[#f4f4f5]">{u.name ?? u.email}</p>
                    <p className="font-mono text-label text-ink-secondary dark:text-[#a1a1aa]">{u.email}</p>
                  </td>
                  <td className="px-3 py-3">
                    <button
                      type="button"
                      disabled={busyId === u.id}
                      onClick={() => toggleStaff(u)}
                      className={`px-3 py-1 rounded-sm font-mono text-label uppercase tracking-widest border transition-colors ${
                        u.isStaff
                          ? 'bg-primary text-white border-primary hover:bg-transparent hover:text-primary'
                          : 'border-border dark:border-[#3f3f46] hover:border-primary hover:text-primary'
                      } disabled:opacity-50`}
                    >
                      {u.isStaff ? t('manage.users.staffOn') : t('manage.users.staffOff')}
                    </button>
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex flex-wrap gap-2 mb-2">
                      {u.organizations.map((m) => (
                        <span key={m.slug} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-sm border border-border dark:border-[#3f3f46]">
                          {m.slug}
                          <button onClick={() => removeOrg(u, m.slug)} className="text-red-600">×</button>
                        </span>
                      ))}
                      {u.organizations.length === 0 && <span className="text-ink-secondary dark:text-[#a1a1aa]">{t('manage.users.noOrgs')}</span>}
                    </div>
                    {orgOptions.length > 0 && (
                      <select
                        value=""
                        onChange={(e) => addOrg(u, e.target.value)}
                        className="px-2 py-1 rounded-sm border border-border dark:border-[#3f3f46] bg-white dark:bg-[#27272a] font-body text-body-sm"
                      >
                        <option value="">{t('manage.users.addOrg')}</option>
                        {orgOptions.map((o) => <option key={o.slug} value={o.slug}>{o.slug}</option>)}
                      </select>
                    )}
                  </td>
                </tr>
              )
            })}
            {users.length === 0 && (
              <tr><td colSpan={3} className="px-3 py-6 text-center text-ink-secondary">{t('manage.empty')}</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
