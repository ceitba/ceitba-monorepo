import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  addUserOrganization,
  assignStaff,
  fetchOrganizations,
  fetchUsers,
  removeUserOrganization,
  revokeStaff,
  updateUserOrganizationRole,
  type AdminUser,
  type FetchUsersParams,
  type MembershipRole,
  type OrganizationSummary,
  type UsersPage,
} from '../../api/admin'
import { getCachedSession, getSession } from '../../store/authStore'
import ConfirmDialog from '../../components/ConfirmDialog'
import ErrorBanner from '../../components/ErrorBanner'

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
  const [unassigning, setUnassigning] = useState<AdminUser | null>(null)
  const [removingOrg, setRemovingOrg] = useState<{ user: AdminUser; slug: string } | null>(null)
  const [demotingOrg, setDemotingOrg] = useState<{ user: AdminUser; slug: string } | null>(null)

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
  // Bumped by reload() after a mutation. The fetch itself lives in the effect
  // so it always uses the *current* filters: a reload() captured before an
  // await must not refetch the filters that were active when it started.
  const [refreshTick, setRefreshTick] = useState(0)

  useEffect(() => {
    fetchOrganizations().then(setOrgs).catch(() => setOrgs([]))
  }, [])

  // Debounce the search input. Filter changes reset to page 1 in the same
  // update (not in a follow-up effect), so we don't first fire a wasted
  // request for the new filter on the old page.
  useEffect(() => {
    const next = query.trim()
    if (next === q) return
    const id = setTimeout(() => { setQ(next); setPageNum(1) }, SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(id)
  }, [query, q])

  const params = useMemo<FetchUsersParams>(() => ({
    page: pageNum,
    limit: PAGE_SIZE,
    q: q || undefined,
    sort,
    organization: orgSlug || undefined,
  }), [pageNum, q, sort, orgSlug])

  useEffect(() => {
    const id = ++reqIdRef.current
    setLoading(true)
    fetchUsers(params)
      .then((res) => {
        if (reqIdRef.current !== id) return
        setPage(res)
        setError(null)
        // The result set can shrink under us (e.g. the last user on the last
        // page was removed from the filtered org): clamp to the last page.
        const lastPage = Math.max(1, Math.ceil(res.meta.total / PAGE_SIZE))
        if ((params.page ?? 1) > lastPage) setPageNum(lastPage)
      })
      .catch((e: Error) => {
        if (reqIdRef.current !== id) return
        setError(e.message)
      })
      .finally(() => {
        if (reqIdRef.current === id) setLoading(false)
      })
  }, [params, refreshTick])

  function reload() {
    setRefreshTick((n) => n + 1)
  }

  async function makeStaff(u: AdminUser) {
    setError(null); setBusyId(u.id)
    try {
      await assignStaff({ email: u.email, branch: STAFF_BRANCH, role: STAFF_ROLE, ...defaultStaffRange() })
      reload()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusyId(null)
    }
  }

  async function confirmUnassign() {
    if (!unassigning) return
    const u = unassigning
    setError(null); setBusyId(u.id)
    try {
      await revokeStaff(u.id)
      setUnassigning(null)
      // Unassigning yourself: refresh the session so StaffGuard sees the
      // lost role and leaves /manage instead of showing a dead admin UI.
      if (u.id === getCachedSession()?.id) {
        await getSession({ force: true })
        return
      }
      reload()
    } catch (e) {
      setUnassigning(null)
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

  // Org admins can see the org's followers (names + emails); promoting is
  // instant, demoting goes through a confirm dialog.
  async function setOrgRole(u: AdminUser, slug: string, role: MembershipRole) {
    setError(null); setBusyId(u.id)
    try {
      await updateUserOrganizationRole(u.id, slug, role)
      reload()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusyId(null)
    }
  }

  async function confirmDemoteOrg() {
    if (!demotingOrg) return
    const { user: u, slug } = demotingOrg
    await setOrgRole(u, slug, 'member')
    setDemotingOrg(null)
  }

  async function confirmRemoveOrg() {
    if (!removingOrg) return
    const { user: u, slug } = removingOrg
    setError(null); setBusyId(u.id)
    try {
      await removeUserOrganization(u.id, slug)
      setRemovingOrg(null)
      reload()
    } catch (e) {
      setRemovingOrg(null)
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
      {error && <ErrorBanner onDismiss={() => setError(null)}>{error}</ErrorBanner>}

      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('manage.users.searchPlaceholder')}
          className="flex-1 min-w-[200px] px-3 py-2 rounded-sm border border-border dark:border-night-border bg-white dark:bg-night-surface font-body text-body-sm focus:outline-none focus:border-primary"
        />
        <select
          value={sort}
          onChange={(e) => { setSort(e.target.value as SortKey); setPageNum(1) }}
          className="px-3 py-2 rounded-sm border border-border dark:border-night-border bg-white dark:bg-night-surface font-body text-body-sm"
        >
          <option value="newest">{t('manage.users.sort.newest')}</option>
          <option value="oldest">{t('manage.users.sort.oldest')}</option>
        </select>
        <select
          value={orgSlug}
          onChange={(e) => { setOrgSlug(e.target.value); setPageNum(1) }}
          className="px-3 py-2 rounded-sm border border-border dark:border-night-border bg-white dark:bg-night-surface font-body text-body-sm"
        >
          <option value="">{t('manage.users.filterAllOrgs')}</option>
          {orgs.map((o) => <option key={o.slug} value={o.slug}>{o.name ?? o.slug}</option>)}
        </select>
      </div>

      <div className="overflow-x-auto rounded-card border border-border dark:border-night-border">
        <table className="w-full font-body text-body-sm">
          <thead className="bg-page-bg dark:bg-night-bg">
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
                <tr key={u.id} className="border-t border-border dark:border-night-border align-top">
                  <td className="px-3 py-3">
                    <p className="font-semibold text-ink-primary dark:text-night-text">{u.name ?? u.email}</p>
                    <p className="font-mono text-label text-ink-secondary dark:text-night-muted">{u.email}</p>
                  </td>
                  <td className="px-3 py-3">
                    {u.isStaff ? (
                      <div className="flex flex-wrap items-center gap-3">
                        <span className="px-3 py-1 rounded-sm bg-primary text-white border border-primary font-mono text-label uppercase tracking-widest">
                          {t('manage.users.staffOn')}
                        </span>
                        <button
                          type="button"
                          disabled={busyId === u.id}
                          onClick={() => setUnassigning(u)}
                          className="text-red-600 dark:text-red-400 font-mono text-label uppercase tracking-widest hover:underline disabled:opacity-50"
                        >
                          {t('manage.users.unassign')}
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        disabled={busyId === u.id}
                        onClick={() => makeStaff(u)}
                        className="px-3 py-1 rounded-sm font-mono text-label uppercase tracking-widest border border-border dark:border-night-border hover:border-primary hover:text-primary transition-colors disabled:opacity-50"
                      >
                        {t('manage.users.staffOff')}
                      </button>
                    )}
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex flex-wrap gap-2 mb-2">
                      {u.organizations.map((m) => {
                        const isAdmin = m.role === 'admin'
                        return (
                          <span key={m.slug} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-sm border border-border dark:border-night-border">
                            {m.slug}
                            <button
                              type="button"
                              disabled={busyId === u.id}
                              onClick={() => (isAdmin
                                ? setDemotingOrg({ user: u, slug: m.slug })
                                : setOrgRole(u, m.slug, 'admin'))}
                              aria-label={t(isAdmin ? 'manage.users.makeOrgMember' : 'manage.users.makeOrgAdmin', { org: m.slug })}
                              title={t(isAdmin ? 'manage.users.makeOrgMember' : 'manage.users.makeOrgAdmin', { org: m.slug })}
                              className={isAdmin
                                ? 'px-1.5 rounded-sm bg-primary text-white border border-primary font-mono text-label uppercase tracking-widest disabled:opacity-50'
                                : 'px-1.5 rounded-sm border border-border dark:border-night-border text-ink-secondary dark:text-night-muted font-mono text-label uppercase tracking-widest hover:border-primary hover:text-primary transition-colors disabled:opacity-50'}
                            >
                              {t(isAdmin ? 'manage.users.orgAdmin' : 'manage.users.orgMember')}
                            </button>
                            <button
                              type="button"
                              disabled={busyId === u.id}
                              onClick={() => setRemovingOrg({ user: u, slug: m.slug })}
                              aria-label={t('manage.users.removeOrgAria', { org: m.slug, name: u.name ?? u.email })}
                              className="text-red-600 dark:text-red-400 disabled:opacity-50"
                            >
                              ×
                            </button>
                          </span>
                        )
                      })}
                      {u.organizations.length === 0 && <span className="text-ink-secondary dark:text-night-muted">{t('manage.users.noOrgs')}</span>}
                    </div>
                    {orgOptions.length > 0 && (
                      <select
                        value=""
                        onChange={(e) => addOrg(u, e.target.value)}
                        className="px-2 py-1 rounded-sm border border-border dark:border-night-border bg-white dark:bg-night-surface font-body text-body-sm"
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
        <span className="font-mono text-label uppercase tracking-widest text-ink-secondary dark:text-night-muted">
          {t('manage.users.pageStatus', { page: pageNum, pages: totalPages, total })}
        </span>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={pageNum <= 1 || loading}
            onClick={() => setPageNum((n) => Math.max(1, n - 1))}
            className="px-3 py-1 rounded-sm border border-border dark:border-night-border font-mono text-label uppercase tracking-widest disabled:opacity-40 hover:border-primary hover:text-primary transition-colors"
          >
            {t('manage.users.prev')}
          </button>
          <button
            type="button"
            disabled={pageNum >= totalPages || loading}
            onClick={() => setPageNum((n) => Math.min(totalPages, n + 1))}
            className="px-3 py-1 rounded-sm border border-border dark:border-night-border font-mono text-label uppercase tracking-widest disabled:opacity-40 hover:border-primary hover:text-primary transition-colors"
          >
            {t('manage.users.next')}
          </button>
        </div>
      </div>

      {unassigning && (
        <ConfirmDialog
          title={t('manage.users.unassignTitle')}
          body={t('manage.users.unassignBody', { name: unassigning.name ?? unassigning.email })}
          confirmLabel={t('manage.users.unassignConfirm')}
          busy={busyId === unassigning.id}
          onConfirm={confirmUnassign}
          onCancel={() => setUnassigning(null)}
        />
      )}

      {demotingOrg && (
        <ConfirmDialog
          title={t('manage.users.demoteOrgTitle')}
          body={t('manage.users.demoteOrgBody', { name: demotingOrg.user.name ?? demotingOrg.user.email, org: demotingOrg.slug })}
          confirmLabel={t('manage.users.demoteOrgConfirm')}
          busy={busyId === demotingOrg.user.id}
          onConfirm={confirmDemoteOrg}
          onCancel={() => setDemotingOrg(null)}
        />
      )}

      {removingOrg && (
        <ConfirmDialog
          title={t('manage.users.removeOrgTitle')}
          body={t('manage.users.removeOrgBody', { name: removingOrg.user.name ?? removingOrg.user.email, org: removingOrg.slug })}
          confirmLabel={t('manage.users.removeOrgConfirm')}
          busy={busyId === removingOrg.user.id}
          onConfirm={confirmRemoveOrg}
          onCancel={() => setRemovingOrg(null)}
        />
      )}
    </div>
  )
}
