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
import {
  Alert, Badge, Button, CloseIcon, EmptyState, ErrorState, Field, IconButton, Modal, SkeletonRows, ToggleGroup,
  inputClass, selectClass, toast,
} from '../../components/ui'
import { adminErrorMessage } from './adminErrors'
import { InviteToOrgModal, PendingOrgInvites } from './ManageOrgInvites'

const STAFF_BRANCH = 'DIRECTIVES'
const STAFF_ROLE = 'MEMBER'
const PAGE_SIZE = 20
const SEARCH_DEBOUNCE_MS = 300
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

// One year is the default tenure; staff can re-assign with a custom range
// directly via /v1/staff if they need precision.
function defaultStaffRange() {
  const start = new Date()
  const end = new Date()
  end.setFullYear(start.getFullYear() + 1)
  return { start: start.toISOString(), end: end.toISOString() }
}

type SortKey = 'newest' | 'oldest'
type Scope = 'all' | 'staff'

// Personas: everyone who signed in to the site (Staff and Usuarios used to
// be two tabs over the same people). `initialAddingTo` opens it in "adding
// members to <org>" mode (from
// "Agregar miembros" in the Organizations tab): every user is listed, as
// usual, and each row that isn't in that org gets a one-click
// "Agregar a <org>" button. A new org has no members, so filtering by it
// would only show an empty table. People who never signed in aren't listed:
// "Invitar por email" adds them as pending invites, claimed on first login.
export default function ManageUsersSection({ initialAddingTo }: { initialAddingTo?: OrganizationSummary } = {}) {
  const { t } = useTranslation()
  const [page, setPage]       = useState<UsersPage | null>(null)
  const [orgs, setOrgs]       = useState<OrganizationSummary[]>([])
  const [orgsError, setOrgsError] = useState<string | null>(null)
  const [orgsTick, setOrgsTick]   = useState(0)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [busyId, setBusyId]   = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  // Granting and revoking STAFF change who can use this panel: both confirm.
  const [staffChange, setStaffChange] = useState<{ user: AdminUser; grant: boolean } | null>(null)
  const [staffError, setStaffError]   = useState<string | null>(null)
  // "+ Organización" opens one small dialog instead of a dropdown on every row.
  const [orgPicker, setOrgPicker] = useState<{ user: AdminUser; options: OrganizationSummary[] } | null>(null)
  const [pickedOrg, setPickedOrg] = useState('')

  // Filters / paging state. `query` is the input value; `q` is the debounced
  // value that actually drives requests, so we don't fire one fetch per keystroke.
  const [query, setQuery]     = useState('')
  const [q, setQ]             = useState('')
  const [sort, setSort]       = useState<SortKey>('newest')
  const [orgSlug, setOrgSlug] = useState('')
  const [scope, setScope]     = useState<Scope>('all')
  const [pageNum, setPageNum] = useState(1)
  const [addingTo, setAddingTo] = useState<OrganizationSummary | null>(initialAddingTo ?? null)
  // Invite-by-email dialog: null = closed, otherwise its prefilled text.
  const [inviting, setInviting] = useState<string | null>(null)
  const [invitesTick, setInvitesTick] = useState(0)

  // The tab can be re-opened in "adding" mode for another org while mounted.
  useEffect(() => { setAddingTo(initialAddingTo ?? null) }, [initialAddingTo])

  // Entering the mode: go straight to the search box.
  const searchRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (addingTo) searchRef.current?.focus()
  }, [addingTo])

  // Track the active request so an out-of-order response (e.g. fast keystrokes)
  // can't overwrite the latest one.
  const reqIdRef = useRef(0)
  // Bumped by reload() after a mutation. The fetch itself lives in the effect
  // so it always uses the *current* filters: a reload() captured before an
  // await must not refetch the filters that were active when it started.
  const [refreshTick, setRefreshTick] = useState(0)

  useEffect(() => {
    let active = true
    setOrgsError(null)
    fetchOrganizations()
      .then((data) => { if (active) setOrgs(data) })
      .catch((e) => { if (active) setOrgsError(adminErrorMessage(e, t)) })
    return () => { active = false }
  }, [orgsTick, t])

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
    staff: scope === 'staff' || undefined,
  }), [pageNum, q, sort, orgSlug, scope])

  useEffect(() => {
    const id = ++reqIdRef.current
    setLoading(true)
    fetchUsers(params)
      .then((res) => {
        if (reqIdRef.current !== id) return
        setPage(res)
        setLoadError(null)
        // The result set can shrink under us (e.g. the last user on the last
        // page was removed from the filtered org): clamp to the last page.
        const lastPage = Math.max(1, Math.ceil(res.meta.total / PAGE_SIZE))
        if ((params.page ?? 1) > lastPage) setPageNum(lastPage)
      })
      .catch((e: unknown) => {
        if (reqIdRef.current !== id) return
        setLoadError(adminErrorMessage(e, t))
      })
      .finally(() => {
        if (reqIdRef.current === id) setLoading(false)
      })
  }, [params, refreshTick, t])

  function reload() {
    setRefreshTick((n) => n + 1)
  }

  const orgName = (slug: string) => orgs.find((o) => o.slug === slug)?.name ?? slug
  const userName = (u: AdminUser) => u.name ?? u.email

  async function confirmStaffChange() {
    if (!staffChange) return
    const { user: u, grant } = staffChange
    setStaffError(null); setBusyId(u.id)
    try {
      if (grant) {
        await assignStaff({ email: u.email, branch: STAFF_BRANCH, role: STAFF_ROLE, ...defaultStaffRange() })
      } else {
        await revokeStaff(u.id)
      }
      setStaffChange(null)
      // Unassigning yourself: refresh the session so StaffGuard sees the
      // lost role and leaves /manage instead of showing a dead admin UI.
      if (!grant && u.id === getCachedSession()?.id) {
        await getSession({ force: true })
        return
      }
      reload()
    } catch (e) {
      setStaffError(adminErrorMessage(e, t))
    } finally {
      setBusyId(null)
    }
  }

  // Resolves true when the membership was added (the picker closes only then).
  async function addOrg(u: AdminUser, slug: string): Promise<boolean> {
    if (!slug) return false
    setBusyId(u.id)
    try {
      const m = await addUserOrganization(u.id, slug, 'member')
      // Show the chip (and drop the "Agregar a" button) right away instead of
      // re-enabling the button until the reload lands, which would invite a
      // second click and a 409.
      setPage((p) => p && {
        ...p,
        data: p.data.map((x) => (x.id === u.id && !x.organizations.some((o) => o.slug === m.slug)
          ? { ...x, organizations: [...x.organizations, m] }
          : x)),
      })
      reload()
      return true
    } catch (e) {
      toast.error(adminErrorMessage(e, t))
      return false
    } finally {
      setBusyId(null)
    }
  }

  // Org admins can see the org's followers (names + emails). Both directions
  // are a single click: the change can be undone the same way.
  async function setOrgRole(u: AdminUser, slug: string, role: MembershipRole) {
    setBusyId(u.id)
    try {
      await updateUserOrganizationRole(u.id, slug, role)
      reload()
    } catch (e) {
      toast.error(adminErrorMessage(e, t))
    } finally {
      setBusyId(null)
    }
  }

  // Removing a membership is undone by adding the person back, so it
  // doesn't ask; the toast says what happened.
  async function removeOrg(u: AdminUser, slug: string) {
    setBusyId(u.id)
    try {
      await removeUserOrganization(u.id, slug)
      toast.success(t('manage.users.removedFromOrg', { name: userName(u), org: orgName(slug) }))
      reload()
    } catch (e) {
      toast.error(adminErrorMessage(e, t))
    } finally {
      setBusyId(null)
    }
  }

  const users = page?.data ?? []
  const total = page?.meta.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  return (
    <div className="flex flex-col gap-4">
      {orgsError && (
        <Alert
          tone="error"
          action={<Button size="sm" variant="outline" onClick={() => setOrgsTick((n) => n + 1)}>{t('errors.retry')}</Button>}
        >
          {t('manage.users.orgsLoadError')}
        </Alert>
      )}

      {addingTo && (
        <Alert
          tone="info"
          action={
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => setInviting('')}>{t('manage.users.invites.open')}</Button>
              <Button size="sm" variant="outline" onClick={() => setAddingTo(null)}>{t('manage.users.addingDone')}</Button>
            </div>
          }
        >
          {t('manage.users.addingBanner', { org: addingTo.name })}
        </Alert>
      )}
      {addingTo && <PendingOrgInvites key={addingTo.slug} org={addingTo} tick={invitesTick} />}

      <ToggleGroup<Scope>
        joined
        className="self-start"
        label={t('manage.users.scopeAria')}
        value={scope}
        onChange={(next) => { setScope(next); setPageNum(1) }}
        options={[
          { value: 'all', label: t('manage.users.scope.all') },
          { value: 'staff', label: t('manage.users.scope.staff') },
        ]}
      />

      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={searchRef}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('manage.users.searchPlaceholder')}
          aria-label={t('manage.users.searchAria')}
          className={inputClass({ className: 'flex-1 min-w-[200px] w-auto!' })}
        />
        <select
          value={sort}
          onChange={(e) => { setSort(e.target.value as SortKey); setPageNum(1) }}
          aria-label={t('manage.users.sortAria')}
          className={selectClass({ className: 'w-auto!' })}
        >
          <option value="newest">{t('manage.users.sort.newest')}</option>
          <option value="oldest">{t('manage.users.sort.oldest')}</option>
        </select>
        <select
          value={orgSlug}
          onChange={(e) => { setOrgSlug(e.target.value); setPageNum(1) }}
          aria-label={t('manage.users.filterOrgAria')}
          className={selectClass({ className: 'w-auto!' })}
        >
          <option value="">{t('manage.users.filterAllOrgs')}</option>
          {orgs.map((o) => <option key={o.slug} value={o.slug}>{o.name}</option>)}
        </select>
      </div>

      {loadError && !page ? (
        <ErrorState message={loadError} onRetry={reload} />
      ) : (
        <>
          {loadError && (
            <Alert tone="error" action={<Button size="sm" variant="outline" onClick={reload}>{t('errors.retry')}</Button>}>
              {loadError}
            </Alert>
          )}
          <div className="overflow-x-auto rounded-card border border-border dark:border-night-border bg-white dark:bg-night-surface">
            <table className="w-full font-body text-body-sm" aria-busy={loading || undefined}>
              <thead className="bg-page-bg dark:bg-night-raised text-ink-secondary dark:text-night-muted">
                <tr className="text-left">
                  <th className="px-3 py-2 font-mono text-label uppercase tracking-widest">{t('manage.users.col.user')}</th>
                  <th className="px-3 py-2 font-mono text-label uppercase tracking-widest">{t('manage.users.col.staff')}</th>
                  <th className="px-3 py-2 font-mono text-label uppercase tracking-widest">{t('manage.users.col.organizations')}</th>
                </tr>
              </thead>
              <tbody>
                {!page && loading && <SkeletonRows rows={8} cols={3} />}
                {users.map((u) => {
                  const orgOptions = orgs.filter((o) => !u.organizations.find((m) => m.slug === o.slug))
                  const busy = busyId === u.id
                  return (
                    <tr key={u.id} className="border-t border-border dark:border-night-border align-top">
                      <td className="px-3 py-3">
                        <p className="font-semibold text-ink-primary dark:text-night-text">{userName(u)}</p>
                        <p className="font-mono text-label text-ink-secondary dark:text-night-muted">{u.email}</p>
                      </td>
                      <td className="px-3 py-3">
                        {u.isStaff ? (
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge tone="info">{t('manage.users.staffOn')}</Badge>
                            <Button
                              size="sm"
                              variant="dangerGhost"
                              disabled={busy}
                              onClick={() => { setStaffError(null); setStaffChange({ user: u, grant: false }) }}
                              aria-label={t('manage.users.unassignAria', { name: userName(u) })}
                            >
                              {t('manage.users.unassign')}
                            </Button>
                          </div>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busy}
                            onClick={() => { setStaffError(null); setStaffChange({ user: u, grant: true }) }}
                            aria-label={t('manage.users.assignAria', { name: userName(u) })}
                          >
                            {t('manage.users.staffOff')}
                          </Button>
                        )}
                      </td>
                      <td className="px-3 py-3">
                        {addingTo && !u.organizations.some((m) => m.slug === addingTo.slug) && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="mb-2"
                            loading={busy}
                            loadingLabel={t('manage.users.addingToOrg')}
                            onClick={() => addOrg(u, addingTo.slug)}
                            aria-label={t('manage.users.addToOrgAria', { org: addingTo.name, name: userName(u) })}
                          >
                            {t('manage.users.addToOrg', { org: addingTo.name })}
                          </Button>
                        )}
                        {u.organizations.length > 0 ? (
                          <ul className="flex flex-col gap-1 mb-2">
                            {u.organizations.map((m) => {
                              const isAdmin = m.role === 'admin'
                              const org = orgName(m.slug)
                              return (
                                <li key={m.slug} className="flex flex-wrap items-center gap-x-2 gap-y-1">
                                  <span className="font-semibold text-ink-primary dark:text-night-text">{org}</span>
                                  <Badge tone={isAdmin ? 'info' : 'neutral'}>
                                    {t(isAdmin ? 'manage.users.orgAdmin' : 'manage.users.orgMember')}
                                  </Badge>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    disabled={busy}
                                    onClick={() => setOrgRole(u, m.slug, isAdmin ? 'member' : 'admin')}
                                    aria-label={t(isAdmin ? 'manage.users.makeOrgMemberAria' : 'manage.users.makeOrgAdminAria', { org, name: userName(u) })}
                                  >
                                    {t(isAdmin ? 'manage.users.makeOrgMember' : 'manage.users.makeOrgAdmin')}
                                  </Button>
                                  <IconButton
                                    size="sm"
                                    disabled={busy}
                                    onClick={() => removeOrg(u, m.slug)}
                                    aria-label={t('manage.users.removeOrgAria', { org, name: userName(u) })}
                                    className="hover:text-red-600! dark:hover:text-red-400!"
                                  >
                                    <CloseIcon size={16} />
                                  </IconButton>
                                </li>
                              )
                            })}
                          </ul>
                        ) : (
                          <p className="mb-2 text-ink-secondary dark:text-night-muted">{t('manage.users.noOrgs')}</p>
                        )}
                        {orgOptions.length > 0 && (
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={busy}
                            onClick={() => { setPickedOrg(orgOptions[0]?.slug ?? ''); setOrgPicker({ user: u, options: orgOptions }) }}
                            aria-label={t('manage.users.addOrgAria', { name: userName(u) })}
                          >
                            {t('manage.users.addOrgButton')}
                          </Button>
                        )}
                      </td>
                    </tr>
                  )
                })}
                {page && !loading && users.length === 0 && (
                  <tr>
                    <td colSpan={3} className="px-3">
                      {orgSlug && !q ? (
                        // Filtering by an org with no members: offer the same
                        // "adding members" mode the Organizations tab opens.
                        <EmptyState
                          compact
                          title={t('manage.users.noOrgMembers', { org: orgName(orgSlug) })}
                          body={t('manage.users.noOrgMembersHint')}
                          action={
                            <Button
                              variant="outline"
                              onClick={() => {
                                setAddingTo(orgs.find((o) => o.slug === orgSlug) ?? { slug: orgSlug, name: orgSlug })
                                setOrgSlug('')
                                setPageNum(1)
                              }}
                            >
                              {t('manage.users.addMembers')}
                            </Button>
                          }
                        />
                      ) : addingTo && scope === 'all' && !orgSlug && EMAIL.test(q) ? (
                        // Nobody signed in with that email yet: invite it. Only
                        // unfiltered: a filter may just be hiding an existing user.
                        <EmptyState
                          compact
                          title={t('manage.users.invites.notFound', { email: q })}
                          body={t('manage.users.invites.notFoundHint', { org: addingTo.name })}
                          action={
                            <Button variant="outline" onClick={() => setInviting(q)}>
                              {t('manage.users.invites.inviteOne', { email: q, org: addingTo.name })}
                            </Button>
                          }
                        />
                      ) : (
                        <EmptyState
                          compact
                          title={t(q ? 'manage.users.noResults' : 'manage.users.empty')}
                          body={t(q ? 'manage.users.noResultsHint' : 'manage.users.emptyHint')}
                        />
                      )}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 font-body text-body-sm">
            <span className="font-mono text-label uppercase tracking-widest text-ink-secondary dark:text-night-muted">
              {t('manage.users.pageStatus', { page: pageNum, pages: totalPages, total })}
            </span>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" disabled={pageNum <= 1 || loading} onClick={() => setPageNum((n) => Math.max(1, n - 1))}>
                {t('manage.users.prev')}
              </Button>
              <Button size="sm" variant="outline" disabled={pageNum >= totalPages || loading} onClick={() => setPageNum((n) => Math.min(totalPages, n + 1))}>
                {t('manage.users.next')}
              </Button>
            </div>
          </div>
        </>
      )}

      {orgPicker && (
        <Modal
          title={t('manage.users.addOrgTitle', { name: userName(orgPicker.user) })}
          onClose={() => setOrgPicker(null)}
          busy={busyId === orgPicker.user.id}
          footer={
            <>
              <Button variant="ghost" onClick={() => setOrgPicker(null)} disabled={busyId === orgPicker.user.id}>{t('ui.cancel')}</Button>
              <Button
                loading={busyId === orgPicker.user.id}
                disabled={!pickedOrg}
                onClick={async () => { if (await addOrg(orgPicker.user, pickedOrg)) setOrgPicker(null) }}
              >
                {t('manage.users.addOrgConfirm')}
              </Button>
            </>
          }
        >
          <Field label={t('manage.users.addOrgField')} hint={t('manage.users.addOrgHint')}>
            {(p) => (
              <select {...p} value={pickedOrg} onChange={(e) => setPickedOrg(e.target.value)} className={selectClass()}>
                {orgPicker.options.map((o) => <option key={o.slug} value={o.slug}>{o.name}</option>)}
              </select>
            )}
          </Field>
        </Modal>
      )}

      {addingTo && inviting !== null && (
        <InviteToOrgModal
          org={addingTo}
          initial={inviting}
          onClose={() => setInviting(null)}
          onDone={() => {
            setInviting(null)
            setInvitesTick((n) => n + 1)
            // Emails of people who already signed in were added right away.
            reload()
          }}
        />
      )}

      {staffChange && (
        <ConfirmDialog
          title={t(staffChange.grant ? 'manage.users.assignTitle' : 'manage.users.unassignTitle', { name: userName(staffChange.user) })}
          body={t(staffChange.grant ? 'manage.users.assignBody' : 'manage.users.unassignBody', { name: userName(staffChange.user) })}
          confirmLabel={t(staffChange.grant ? 'manage.users.assignConfirm' : 'manage.users.unassignConfirm')}
          danger={!staffChange.grant}
          busy={busyId === staffChange.user.id}
          error={staffError}
          onConfirm={confirmStaffChange}
          onCancel={() => setStaffChange(null)}
        />
      )}
    </div>
  )
}
