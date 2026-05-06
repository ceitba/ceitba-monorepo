import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  addUserOrganization,
  assignStaff,
  fetchOrganizations,
  fetchUsers,
  removeUserOrganization,
  revokeStaff,
  type AdminUser,
  type FetchUsersParams,
  type OrganizationSummary,
  type UsersPage,
} from '../../api/admin'

const STAFF_BRANCH = 'DIRECTIVES'
const STAFF_ROLE = 'MEMBER'
const PAGE_SIZE = 20
const SEARCH_DEBOUNCE_MS = 300

// One year is the default tenure; staff can re-assign with a custom range
// directly via /v1/staff if they need precision.
function defaultStaffRange() {
  const start = new Date()
  const end = new Date()
  end.setFullYear(start.getFullYear() + 1)
  return { start: start.toISOString(), end: end.toISOString() }
}

type SortKey = 'newest' | 'oldest'

export default function ManageUsersSection() {
  const { t } = useTranslation()
  const [page, setPage]       = useState<UsersPage | null>(null)
  const [orgs, setOrgs]       = useState<OrganizationSummary[]>([])
  const [error, setError]     = useState<string | null>(null)
  const [busyId, setBusyId]   = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  // Filters / paging state. `query` is the input value; `q` is the debounced
  // value that actually drives requests, so we don't fire one fetch per keystroke.
  const [query, setQuery]     = useState('')
  const [q, setQ]             = useState('')
  const [sort, setSort]       = useState<SortKey>('newest')
  const [orgSlug, setOrgSlug] = useState('')
  const [pageNum, setPageNum] = useState(1)

  // Track the active request so an out-of-order response (e.g. fast keystrokes)
  // can't overwrite the latest one.
  const reqIdRef = useRef(0)

  useEffect(() => {
    fetchOrganizations().then(setOrgs).catch(() => setOrgs([]))
  }, [])

  // Debounce the search input.
  useEffect(() => {
    const id = setTimeout(() => setQ(query.trim()), SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(id)
  }, [query])

  // Reset to page 1 whenever filters or sort change so the user doesn't end
  // up looking at "page 5" of a 1-page result set.
  useEffect(() => {
    setPageNum(1)
  }, [q, sort, orgSlug])

  const params = useMemo<FetchUsersParams>(() => ({
    page: pageNum,
    limit: PAGE_SIZE,
    q: q || undefined,
    sort,
    organization: orgSlug || undefined,
  }), [pageNum, q, sort, orgSlug])

  function reload() {
    const id = ++reqIdRef.current
    setLoading(true)
    fetchUsers(params)
      .then((res) => {
        if (reqIdRef.current !== id) return
        setPage(res)
        setError(null)
      })
      .catch((e: Error) => {
        if (reqIdRef.current !== id) return
        setError(e.message)
      })
      .finally(() => {
        if (reqIdRef.current === id) setLoading(false)
      })
  }

  useEffect(() => {
    reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params])

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

  const users = page?.data ?? []
  const total = page?.meta.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  return (
    <div className="flex flex-col gap-4">
      {error && <p className="px-3 py-2 rounded-sm bg-red-50 text-red-700 font-body text-body-sm border border-red-200">{error}</p>}

      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('manage.users.searchPlaceholder')}
          className="flex-1 min-w-[200px] px-3 py-2 rounded-sm border border-border dark:border-[#3f3f46] bg-white dark:bg-[#27272a] font-body text-body-sm focus:outline-none focus:border-primary"
        />
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as SortKey)}
          className="px-3 py-2 rounded-sm border border-border dark:border-[#3f3f46] bg-white dark:bg-[#27272a] font-body text-body-sm"
        >
          <option value="newest">{t('manage.users.sort.newest')}</option>
          <option value="oldest">{t('manage.users.sort.oldest')}</option>
        </select>
        <select
          value={orgSlug}
          onChange={(e) => setOrgSlug(e.target.value)}
          className="px-3 py-2 rounded-sm border border-border dark:border-[#3f3f46] bg-white dark:bg-[#27272a] font-body text-body-sm"
        >
          <option value="">{t('manage.users.filterAllOrgs')}</option>
          {orgs.map((o) => <option key={o.slug} value={o.slug}>{o.name ?? o.slug}</option>)}
        </select>
      </div>

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
            {!loading && users.length === 0 && (
              <tr><td colSpan={3} className="px-3 py-6 text-center text-ink-secondary">{t('manage.empty')}</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between gap-2 font-body text-body-sm">
        <span className="font-mono text-label uppercase tracking-widest text-ink-secondary dark:text-[#a1a1aa]">
          {t('manage.users.pageStatus', { page: pageNum, pages: totalPages, total })}
        </span>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={pageNum <= 1 || loading}
            onClick={() => setPageNum((n) => Math.max(1, n - 1))}
            className="px-3 py-1 rounded-sm border border-border dark:border-[#3f3f46] font-mono text-label uppercase tracking-widest disabled:opacity-40 hover:border-primary hover:text-primary transition-colors"
          >
            {t('manage.users.prev')}
          </button>
          <button
            type="button"
            disabled={pageNum >= totalPages || loading}
            onClick={() => setPageNum((n) => Math.min(totalPages, n + 1))}
            className="px-3 py-1 rounded-sm border border-border dark:border-[#3f3f46] font-mono text-label uppercase tracking-widest disabled:opacity-40 hover:border-primary hover:text-primary transition-colors"
          >
            {t('manage.users.next')}
          </button>
        </div>
      </div>
    </div>
  )
}
